package arcbase

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"testing"

	"github.com/fudanda/arcbase/backend/ent/department"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/fudanda/arcbase/backend/internal/security"
)

func domainServiceFixture(t *testing.T) (context.Context, *Store, *services, string, string) {
	t.Helper()
	ctx := context.Background()
	store := sqliteStore(t)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	password, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	if err = store.InitAdmin(ctx, "service-admin", password); err != nil {
		t.Fatal(err)
	}
	authRaw, _ := json.Marshal(contracts.Settings["auth"].Defaults)
	var auth map[string]any
	json.Unmarshal(authRaw, &auth)
	auth["captchaEnabled"] = false
	if err = store.Client.SystemSetting.Create().SetModule("auth").SetVersion(1).SetData(auth).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	services := assembleServices(store, configuredFileStorage(Config{}))
	result, err := services.identity.Login(ctx, kernel.Input{SourceValid: true, IP: "192.0.2.20", Body: json.RawMessage(`{"username":"service-admin","password":"` + password + `"}`)})
	if err != nil || result.Cookie == nil {
		t.Fatal("service login", err)
	}
	principal, err := services.identity.Authenticate(ctx, result.Cookie.Token)
	if err != nil {
		t.Fatal(err)
	}
	return security.WithPrincipal(ctx, principal), store, services, result.Cookie.Token, password
}

func TestDepartmentServicePatchAndAuditRollbackWithoutHTTP(t *testing.T) {
	ctx, store, services, _, _ := domainServiceFixture(t)
	created, err := services.organization.SaveDepartment(ctx, kernel.Input{TraceID: "department-service", Body: json.RawMessage(`{"name":"原部门","code":"service_dept"}`)})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Data.(map[string]any)["id"].(int)
	if _, err = services.organization.SaveDepartment(ctx, kernel.Input{Id: strconv.Itoa(id), Update: true, Body: json.RawMessage(`{"name":"修改部门"}`)}); err != nil {
		t.Fatal(err)
	}
	row, err := store.Client.Department.Get(ctx, id)
	if err != nil || row.Code != "service_dept" || row.Name != "修改部门" {
		t.Fatal("omitted fields changed", row, err)
	}
	if _, err = store.DB.ExecContext(ctx, `CREATE TRIGGER reject_department_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;`); err != nil {
		t.Fatal(err)
	}
	if _, err = services.organization.SaveDepartment(ctx, kernel.Input{Body: json.RawMessage(`{"name":"应回滚","code":"rollback_dept"}`)}); err == nil {
		t.Fatal("audit failure accepted")
	}
	if found, err := store.Client.Department.Query().Where(department.CodeEQ("rollback_dept")).Exist(ctx); err != nil || found {
		t.Fatal("business write survived audit rollback", err)
	}
}

func TestSettingsAndPasswordServicesInvalidateImmediately(t *testing.T) {
	ctx, _, services, token, password := domainServiceFixture(t)
	data, _ := json.Marshal(map[string]any{"version": 0, "data": contracts.Settings["files"].Defaults})
	if _, err := services.configuration.UpdateFileSettings(ctx, kernel.Input{Body: data}); err != nil {
		t.Fatal(err)
	}
	if _, err := services.configuration.UpdateFileSettings(ctx, kernel.Input{Body: data}); err == nil {
		t.Fatal("stale settings version accepted")
	} else {
		var fault *kernel.Fault
		if !errors.As(err, &fault) || fault.Status != 409 {
			t.Fatalf("wrong conflict: %v", err)
		}
	}
	newPassword, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"oldPassword": password, "newPassword": newPassword})
	if _, err = services.identity.ChangePassword(ctx, kernel.Input{Body: body}); err != nil {
		t.Fatal(err)
	}
	if _, err = services.identity.Authenticate(ctx, token); !errors.Is(err, kernel.ErrUnauthenticated) {
		t.Fatal("old session remained authenticated", err)
	}
}

type oneServiceUpload struct{ used bool }

func (s *oneServiceUpload) Next() (kernel.Upload, error) {
	if s.used {
		return kernel.Upload{}, io.EOF
	}
	s.used = true
	return kernel.Upload{Name: "service.txt", Reader: io.NopCloser(bytes.NewBufferString("服务层真实文件"))}, nil
}

func TestFileServiceStreamsRemainReadableAfterReturn(t *testing.T) {
	ctx, _, services, _, _ := domainServiceFixture(t)
	config, _ := json.Marshal(map[string]any{"name": "服务层本地存储", "provider": "local", "localRootPath": t.TempDir(), "isDefault": true})
	if _, err := services.files.SaveFileConfig(ctx, kernel.Input{Body: config}); err != nil {
		t.Fatal(err)
	}
	uploaded, err := services.files.UploadOne(ctx, kernel.Input{Filter: kernel.Values{"visibility": {"restricted"}}, Files: &oneServiceUpload{}})
	if err != nil {
		t.Fatal(err)
	}
	id := uploaded.Data.(map[string]any)["id"].(string)
	result, err := services.files.PrivateFileContent(ctx, kernel.Input{Id: id})
	if err != nil || result.Binary == nil {
		t.Fatal("private content", err)
	}
	raw, err := io.ReadAll(result.Binary.Reader)
	result.Binary.Close()
	if err != nil || string(raw) != "服务层真实文件" {
		t.Fatal("stream closed before consumption", err)
	}
	body, _ := json.Marshal(map[string]any{"ids": []string{id}})
	result, err = services.files.DownloadFilesBatch(ctx, kernel.Input{Body: body})
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	if err = result.Write(&buffer); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	if err != nil || len(archive.File) != 1 {
		t.Fatal("invalid zip", err)
	}
	reader, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	raw, err = io.ReadAll(reader)
	reader.Close()
	if err != nil || string(raw) != "服务层真实文件" {
		t.Fatal("archive content changed", err)
	}
}
