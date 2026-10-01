//go:build integration

package zenith

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"

	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/google/uuid"
)

func (a *apiFixture) adminResponse(method, path string, body any) *httptest.ResponseRecorder {
	return a.call(method, path, body, a.cookie, a.csrf, "192.0.2.1")
}
func (a *apiFixture) expect(response *httptest.ResponseRecorder, status int) {
	a.t.Helper()
	if response.Code != status {
		a.t.Fatalf("HTTP %d expected %d: %s", response.Code, status, response.Body.String())
	}
}
func (a *apiFixture) multipart(path, field, filename string, content []byte, fields map[string]string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		writer.WriteField(name, value)
	}
	part, err := writer.CreateFormFile(field, filename)
	if err != nil {
		a.t.Fatal(err)
	}
	part.Write(content)
	writer.Close()
	r := httptest.NewRequest("POST", "http://zenith.test"+path, &body)
	r.RemoteAddr = "192.0.2.1:12345"
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("Origin", "http://zenith.test")
	r.Header.Set("X-CSRF-Token", csrf)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.f.Handler().ServeHTTP(w, r)
	return w
}
func TestLocalFilesAndPrivateAccess(t *testing.T) {
	a := newAPIFixture(t)
	root := t.TempDir()
	response := a.adminResponse("POST", "/api/v1/file-storage-configs", map[string]any{"name": "local", "provider": "local", "status": "enabled", "isDefault": true, "localRootPath": root})
	if response.Code != 200 {
		t.Fatalf("storage create: %d", response.Code)
	}
	configID := int(fixtureData(t, response)["id"].(float64))
	a.expect(a.adminResponse("POST", fmt.Sprintf("/api/v1/file-storage-configs/%d/test", configID), map[string]any{}), 200)
	created := a.adminResponse("POST", "/api/v1/users", map[string]any{"username": "file-owner", "nickname": "owner", "password": "OwnerPass123!"})
	uid := int(fixtureData(t, created)["id"].(float64))
	cookie, csrf := a.login("file-owner", "OwnerPass123!", "192.0.2.9")
	var avatar bytes.Buffer
	image := image.NewRGBA(image.Rect(0, 0, 2, 2))
	image.Set(0, 0, color.RGBA{R: 255, A: 255})
	png.Encode(&avatar, image)
	a.expect(a.multipart("/api/v1/auth/avatar", "file", "avatar.png", avatar.Bytes(), nil, cookie, csrf), 200)
	a.expect(a.multipart("/api/v1/auth/avatar", "file", "avatar.png", []byte("not an image"), nil, cookie, csrf), 400)
	// A valid PNG header without pixel data must not become a broken avatar.
	a.expect(a.multipart("/api/v1/auth/avatar", "file", "avatar.png", avatar.Bytes()[:33], nil, cookie, csrf), 400)
	// Upload permission is independently enforced, even for future private owners.
	a.expect(a.multipart("/api/v1/files/upload-one", "file", "private.txt", []byte("private bytes"), nil, cookie, csrf), 403)
	ids, err := a.f.Store.Client.Menu.Query().Where().All(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	menuIDs := []int{}
	for _, item := range ids {
		if item.Permission != nil && *item.Permission == "system:file:upload" {
			menuIDs = append(menuIDs, item.ID)
		}
	}
	a.expect(a.adminResponse("PUT", fmt.Sprintf("/api/v1/users/%d/menus", uid), map[string]any{"menuIds": menuIDs}), 200)
	upload := a.multipart("/api/v1/files/upload-one?visibility=restricted", "file", "private.txt", []byte("private bytes"), nil, cookie, csrf)
	a.expect(upload, 200)
	fileID := fixtureData(t, upload)["id"].(string)
	a.expect(a.call("GET", "/api/v1/files/"+fileID+"/content", nil, nil, "", "192.0.2.3"), 404)
	own := a.call("GET", "/api/v1/files/"+fileID+"/private-content", nil, cookie, csrf, "192.0.2.9")
	a.expect(own, 200)
	if own.Body.String() != "private bytes" {
		t.Fatal("private content changed")
	}
	other := a.adminResponse("POST", "/api/v1/users", map[string]any{"username": "file-other", "nickname": "other", "password": "OtherPass123!"})
	a.expect(other, 200)
	otherCookie, otherCsrf := a.login("file-other", "OtherPass123!", "192.0.2.3")
	a.expect(a.call("GET", "/api/v1/files/"+fileID+"/private-content", nil, otherCookie, otherCsrf, "192.0.2.3"), 403)
	public := a.multipart("/api/v1/files/upload-one", "file", "public.txt", []byte("public bytes"), nil, a.cookie, a.csrf)
	a.expect(public, 200)
	publicID := fixtureData(t, public)["id"].(string)
	a.expect(a.call("GET", "/api/v1/files/"+publicID+"/content", nil, nil, "", "192.0.2.3"), 200)
	a.expect(a.adminResponse("GET", "/api/v1/files/stats", nil), 200)
	a.expect(a.adminResponse("GET", fmt.Sprintf("/api/v1/files/browse?storageConfigId=%d", configID), nil), 200)
	a.expect(a.adminResponse("PUT", fmt.Sprintf("/api/v1/file-storage-configs/%d", configID), map[string]any{"localRootPath": t.TempDir()}), 409)
	init := a.adminResponse("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "chunk.txt", "fileSize": 6 * mib, "mimeType": "text/plain", "chunkSize": 5 * mib, "visibility": "restricted"})
	a.expect(init, 200)
	uploadID := fixtureData(t, init)["uploadId"].(string)
	for i, size := range []int{5 * int(mib), int(mib)} {
		a.expect(a.multipart("/api/v1/files/upload/chunk", "chunk", "part", bytes.Repeat([]byte("A"), size), map[string]string{"uploadId": uploadID, "index": fmt.Sprint(i)}, a.cookie, a.csrf), 200)
	}
	a.expect(a.adminResponse("GET", "/api/v1/files/upload/"+uploadID+"/status", nil), 200)
	completed := a.adminResponse("POST", "/api/v1/files/upload/complete", map[string]any{"uploadId": uploadID})
	a.expect(completed, 200)
	abort := a.adminResponse("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "abort.txt", "fileSize": 1, "chunkSize": 5 * mib})
	a.expect(abort, 200)
	abortID := fixtureData(t, abort)["uploadId"].(string)
	a.expect(a.adminResponse("DELETE", "/api/v1/files/upload/"+abortID, nil), 200)
	// A disk failure keeps metadata pending until a real, reentrant retry removes bytes.
	hidden := root + "-offline"
	if err := os.Rename(root, hidden); err != nil {
		t.Fatal(err)
	}
	deletion := a.adminResponse("DELETE", "/api/v1/files/"+publicID, nil)
	a.expect(deletion, 503)
	if err := os.Rename(hidden, root); err != nil {
		t.Fatal(err)
	}
	id, _ := uuid.Parse(publicID)
	row, err := a.f.Store.Client.ManagedFile.Get(context.Background(), id)
	if err != nil || !row.DeletePending {
		t.Fatal("failed deletion lost retry state")
	}
	a.expect(a.adminResponse("DELETE", "/api/v1/files/"+publicID, nil), 200)
	if err = a.f.removePendingFile(context.Background(), row); !ent.IsNotFound(err) {
		t.Fatal("retry should observe already removed metadata")
	}
	count, err := a.f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id)).Count(context.Background())
	if err != nil || count != 0 {
		t.Fatal("retry did not finish deletion")
	}
}
