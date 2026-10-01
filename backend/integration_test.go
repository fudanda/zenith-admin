//go:build integration

package zenith

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func isolatedTestDSN(t *testing.T, dsn string) string {
	t.Helper()
	if strings.HasPrefix(dsn, "sqlite:") {
		return "sqlite:" + filepath.Join(t.TempDir(), "zenith.db")
	}
	admin, err := OpenStore(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("zenith_api_%d", time.Now().UnixNano())
	if _, err := admin.DB.ExecContext(context.Background(), "CREATE SCHEMA "+name); err != nil {
		_ = admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := admin.DB.ExecContext(context.Background(), "DROP SCHEMA "+name+" CASCADE")
		if err != nil {
			t.Errorf("fixture cleanup: %v", err)
		}
		_ = admin.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", name)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func TestPostgresAuthAndFoundation(t *testing.T) {
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required for integration tests")
	}
	dsn = isolatedTestDSN(t, dsn)
	ctx := context.Background()
	store, err := OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	if err = store.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	username := fmt.Sprintf("admin_%d", time.Now().UnixNano())
	password := "integration-test-password-123"
	if err = store.InitAdmin(ctx, username, password); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := New(ctx, Config{DSN: dsn, SecureCookies: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.Shutdown(context.Background()) })
	handler := f.Handler()
	call := func(method, path string, body any, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
		var payload []byte
		if body != nil {
			payload, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, "http://zenith.test"+path, bytes.NewReader(payload))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if method != http.MethodGet {
			req.Header.Set("Origin", "http://zenith.test")
			req.Header.Set("X-CSRF-Token", csrf)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	read := func(response *httptest.ResponseRecorder) map[string]any {
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}
	captcha := call("GET", "/api/v1/auth/captcha", nil, nil, "")
	if captcha.Code != 200 {
		t.Fatalf("captcha: %d %s", captcha.Code, captcha.Body.String())
	}
	id := read(captcha)["captchaId"].(string)
	image := read(captcha)["image"].(string)
	svg, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(image, "data:image/svg+xml;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`>([A-F0-9]{6})</text>`).FindSubmatch(svg)
	if len(match) != 2 {
		t.Fatalf("captcha SVG did not contain challenge")
	}
	login := call("POST", "/api/v1/auth/login", map[string]any{"username": username, "password": password, "captchaId": id, "captchaAnswer": string(match[1])}, nil, "")
	if login.Code != 200 {
		t.Fatalf("login: %d %s", login.Code, login.Body.String())
	}
	var cookie *http.Cookie
	for _, candidate := range login.Result().Cookies() {
		if candidate.Name == "zenith_session" {
			cookie = candidate
		}
	}
	if cookie == nil || !cookie.HttpOnly || !cookie.Secure {
		t.Fatal("session cookie is not secure")
	}
	csrf := read(login)["csrfToken"].(string)
	adminID := int(read(login)["user"].(map[string]any)["id"].(float64))
	for _, invalid := range []map[string]any{{"colorMode": "invalid"}, {"tablePageSize": 0}, {"showQuickChat": true}, {"homePath": "/workflow"}} {
		if response := call("PUT", "/api/v1/auth/preferences", map[string]any{"overrides": invalid}, cookie, csrf); response.Code != 400 {
			t.Fatalf("invalid preference accepted: %d %s", response.Code, response.Body.String())
		}
	}
	if response := call("PUT", "/api/v1/auth/preferences", map[string]any{"overrides": map[string]any{"colorMode": "dark", "tablePageSize": 20}}, cookie, csrf); response.Code != 200 {
		t.Fatalf("original preference save: %d %s", response.Code, response.Body.String())
	}
	if response := call("GET", "/api/v1/auth/preferences", nil, cookie, ""); response.Code != 200 || read(response)["overrides"].(map[string]any)["colorMode"] != "dark" {
		t.Fatalf("original preference restore: %d %s", response.Code, response.Body.String())
	}
	loginQuery := fmt.Sprintf("/api/v1/login-logs?userId=%d&status=success&eventType=login", adminID)
	if logs := call("GET", loginQuery, nil, cookie, ""); logs.Code != 200 || read(logs)["total"].(float64) < 1 {
		t.Fatalf("login log filters: %d %s", logs.Code, logs.Body.String())
	}
	loginCSV := call("GET", "/api/v1/login-logs/export?userId="+fmt.Sprint(adminID)+"&status=success", nil, cookie, "")
	if loginCSV.Code != 200 || !strings.Contains(loginCSV.Body.String(), username) {
		t.Fatalf("login log CSV: %d %s", loginCSV.Code, loginCSV.Body.String())
	}
	if invalid := call("GET", "/api/v1/login-logs/export?startTime=invalid", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid login log filter accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if invalid := call("GET", "/api/v1/login-logs?status=unknown", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid login log status accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	emptyLoginCSV := call("GET", "/api/v1/login-logs/export?userId=2147483647", nil, cookie, "")
	if emptyLoginCSV.Code != 200 || !strings.Contains(emptyLoginCSV.Body.String(), "用户名") {
		t.Fatalf("empty login CSV lacks header: %d %s", emptyLoginCSV.Code, emptyLoginCSV.Body.String())
	}
	filesSetting := call("GET", "/api/v1/settings/files", nil, cookie, "")
	if filesSetting.Code != 200 {
		t.Fatalf("read file settings: %d %s", filesSetting.Code, filesSetting.Body.String())
	}
	currentSetting := read(filesSetting)
	version := int(currentSetting["version"].(float64))
	values := currentSetting["effective"].(map[string]any)
	beforeThreshold := values["chunkThresholdMb"].(float64)
	if beforeThreshold == 5 {
		values["chunkThresholdMb"] = 6.0
	} else {
		values["chunkThresholdMb"] = 5.0
	}
	settingsSaved := call("PUT", "/api/v1/settings/files", map[string]any{"version": version, "data": values}, cookie, csrf)
	if settingsSaved.Code != 200 {
		t.Fatalf("save file settings: %d %s", settingsSaved.Code, settingsSaved.Body.String())
	}
	if stale := call("PUT", "/api/v1/settings/files", map[string]any{"version": version, "data": values}, cookie, csrf); stale.Code != 409 {
		t.Fatalf("stale settings update: %d %s", stale.Code, stale.Body.String())
	}
	policy := call("GET", "/api/v1/files/upload-policy", nil, cookie, "")
	if policy.Code != 200 || read(policy)["chunkThresholdMb"] != values["chunkThresholdMb"] {
		t.Fatalf("upload policy did not update: %d %s", policy.Code, policy.Body.String())
	}
	values["chunkThresholdMb"] = beforeThreshold
	settingsRestored := call("PUT", "/api/v1/settings/files", map[string]any{"version": version + 1, "data": values}, cookie, csrf)
	if settingsRestored.Code != 200 {
		t.Fatalf("restore file settings: %d %s", settingsRestored.Code, settingsRestored.Body.String())
	}
	beforeMax := values["uploadMaxSizeMb"]
	values["uploadMaxSizeMb"] = 1
	limited := call("PUT", "/api/v1/settings/files", map[string]any{"version": version + 2, "data": values}, cookie, csrf)
	if limited.Code != 200 {
		t.Fatalf("limit file size: %d %s", limited.Code, limited.Body.String())
	}
	tooLarge := call("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "large.bin", "fileSize": 2 * 1024 * 1024, "chunkSize": 5 * 1024 * 1024, "visibility": "restricted"}, cookie, csrf)
	if tooLarge.Code != 400 {
		t.Fatalf("file size policy bypassed: %d %s", tooLarge.Code, tooLarge.Body.String())
	}
	values["uploadMaxSizeMb"] = beforeMax
	unlimited := call("PUT", "/api/v1/settings/files", map[string]any{"version": version + 3, "data": values}, cookie, csrf)
	if unlimited.Code != 200 {
		t.Fatalf("restore size policy: %d %s", unlimited.Code, unlimited.Body.String())
	}
	if me := call("GET", "/api/v1/auth/me", nil, cookie, ""); me.Code != 200 {
		t.Fatalf("session recovery: %d %s", me.Code, me.Body.String())
	}
	if denied := call("POST", "/api/v1/positions", map[string]any{"name": "Denied", "code": "denied"}, cookie, ""); denied.Code != 403 {
		t.Fatalf("missing CSRF accepted: %d", denied.Code)
	}
	menuName := fmt.Sprintf("test_menu_%d", time.Now().UnixNano())
	createdMenu := call("POST", "/api/v1/menus", map[string]any{"title": "测试目录", "name": menuName, "type": "directory"}, cookie, csrf)
	if createdMenu.Code != 201 {
		t.Fatalf("create menu: %d %s", createdMenu.Code, createdMenu.Body.String())
	}
	menuID := int(read(createdMenu)["id"].(float64))
	createdButton := call("POST", "/api/v1/menus", map[string]any{"title": "测试按钮", "name": menuName + "_button", "type": "button", "parentId": menuID, "permission": "system:menu:list"}, cookie, csrf)
	if createdButton.Code != 201 {
		t.Fatalf("create child menu: %d %s", createdButton.Code, createdButton.Body.String())
	}
	buttonID := int(read(createdButton)["id"].(float64))
	if cycle := call("PUT", fmt.Sprintf("/api/v1/menus/%d", menuID), map[string]any{"parentId": buttonID}, cookie, csrf); cycle.Code != 400 {
		t.Fatalf("menu cycle accepted: %d %s", cycle.Code, cycle.Body.String())
	}
	if unsupported := call("POST", "/api/v1/menus", map[string]any{"title": "未迁移页面", "path": "/workflow", "type": "menu"}, cookie, csrf); unsupported.Code != 400 {
		t.Fatalf("unshipped menu path accepted: %d %s", unsupported.Code, unsupported.Body.String())
	}
	if flat := call("GET", "/api/v1/menus/flat", nil, cookie, ""); flat.Code != 200 {
		t.Fatalf("flat menus: %d %s", flat.Code, flat.Body.String())
	}
	if tree := call("GET", "/api/v1/menus", nil, cookie, ""); tree.Code != 200 || !strings.Contains(tree.Body.String(), "\"children\"") {
		t.Fatalf("menu tree missing child: %d %s", tree.Code, tree.Body.String())
	}
	if removed := call("DELETE", fmt.Sprintf("/api/v1/menus/%d", menuID), nil, cookie, csrf); removed.Code != 200 {
		t.Fatalf("remove menu subtree: %d %s", removed.Code, removed.Body.String())
	}
	if missing := call("GET", fmt.Sprintf("/api/v1/menus/%d", buttonID), nil, cookie, ""); missing.Code != 404 {
		t.Fatalf("child menu survived deletion: %d %s", missing.Code, missing.Body.String())
	}
	code := fmt.Sprintf("p%d", time.Now().UnixNano())
	created := call("POST", "/api/v1/positions", map[string]any{"name": "测试岗位", "code": code, "status": "enabled"}, cookie, csrf)
	if created.Code != 201 {
		t.Fatalf("create position: %d %s", created.Code, created.Body.String())
	}
	positionID := int(read(created)["id"].(float64))
	if failed := call("DELETE", "/api/v1/positions/batch", map[string]any{"ids": []int{positionID, 2147483647}}, cookie, csrf); failed.Code != 404 {
		t.Fatalf("mixed position batch must fail: %d %s", failed.Code, failed.Body.String())
	}
	if failed := call("DELETE", "/api/v1/positions/batch", map[string]any{"ids": []int{positionID, positionID}}, cookie, csrf); failed.Code != 400 {
		t.Fatalf("duplicate batch ID accepted: %d %s", failed.Code, failed.Body.String())
	}
	if intact := call("GET", fmt.Sprintf("/api/v1/positions/%d", positionID), nil, cookie, ""); intact.Code != 200 {
		t.Fatal("failed batch removed an existing position")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, read(created)["createdAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	day := createdAt.In(time.Local).Format("2006-01-02")
	filtered := call("GET", "/api/v1/positions?startTime="+day+"&endTime="+day, nil, cookie, "")
	if filtered.Code != 200 || read(filtered)["total"].(float64) < 1 {
		t.Fatalf("position date filter: %d %s", filtered.Code, filtered.Body.String())
	}
	if invalid := call("GET", "/api/v1/positions?startTime=bad-date", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid position date accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	exported := call("GET", "/api/v1/positions/export?keyword="+code+"&status=enabled", nil, cookie, "")
	if exported.Code != 200 || !strings.HasPrefix(exported.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("position CSV export: %d %s", exported.Code, exported.Body.String())
	}
	csvRows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported.Body.String(), "\ufeff"))).ReadAll()
	if err != nil || len(csvRows) != 2 || csvRows[1][2] != code {
		t.Fatalf("position CSV content: %v %#v", err, csvRows)
	}
	if invalid := call("GET", "/api/v1/positions/export?startTime=bad-date", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid CSV filter accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if detail := call("GET", fmt.Sprintf("/api/v1/positions/%d", positionID), nil, cookie, ""); detail.Code != 200 {
		t.Fatalf("position detail: %d %s", detail.Code, detail.Body.String())
	}
	platformDepartmentCode := fmt.Sprintf("d%d", time.Now().UnixNano())
	platformDepartment := call("POST", "/api/v1/departments", map[string]any{"name": "平台部门", "code": platformDepartmentCode}, cookie, csrf)
	if platformDepartment.Code != 200 {
		t.Fatalf("create platform department: %d %s", platformDepartment.Code, platformDepartment.Body.String())
	}
	platformDepartmentCSV := call("GET", "/api/v1/departments/export?keyword="+platformDepartmentCode, nil, cookie, "")
	if platformDepartmentCSV.Code != 200 || !strings.Contains(platformDepartmentCSV.Body.String(), platformDepartmentCode) {
		t.Fatalf("platform department CSV: %d %s", platformDepartmentCSV.Code, platformDepartmentCSV.Body.String())
	}
	platformDict := call("POST", "/api/v1/dicts", map[string]any{"name": "平台字典", "code": "platform_dict_test", "status": "enabled"}, cookie, csrf)
	if platformDict.Code != 200 {
		t.Fatalf("create platform dict: %d %s", platformDict.Code, platformDict.Body.String())
	}
	for _, path := range []string{"/api/v1/tenants", "/api/v1/tenant-packages", "/api/v1/auth/tenant-view"} {
		method := "GET"
		if strings.Contains(path, "tenant-view") {
			method = "PUT"
		}
		if got := call(method, path, nil, cookie, csrf); got.Code != 404 {
			t.Fatalf("removed tenant endpoint %s: %d", path, got.Code)
		}
	}
	if err := f.Store.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	if got := call("GET", "/api/v1/auth/me", nil, cookie, ""); got.Code != 200 {
		t.Fatalf("restored session: %d", got.Code)
	}
}
