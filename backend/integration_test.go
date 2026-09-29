//go:build integration

package zenith

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
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

func TestPostgresVersionedMigrations(t *testing.T) {
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required for integration tests")
	}
	ctx := context.Background()
	admin, err := OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("zenith_migration_%d", time.Now().UnixNano())
	if _, err := admin.DB.ExecContext(ctx, `CREATE SCHEMA `+name); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.DB.ExecContext(context.Background(), `DROP SCHEMA `+name+` CASCADE`) }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", name)
	parsed.RawQuery = query.Encode()
	store, err := OpenStore(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("empty database migration: %v", err)
	}
	var version int
	if err := store.DB.QueryRowContext(ctx, `SELECT MAX(version) FROM zenith_schema_versions`).Scan(&version); err != nil || version != foundationSchemaVersion {
		t.Fatalf("fresh schema version = %d: %v", version, err)
	}
	var hasForeignKey bool
	if err := store.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_fk' AND connamespace = current_schema()::regnamespace)`).Scan(&hasForeignKey); err != nil || !hasForeignKey {
		t.Fatalf("baseline foreign keys missing: %v", err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	// The committed v3 Ent schema differs only by system_settings. Recreate
	// that state in this isolated schema to exercise the real upgrade path.
	if _, err := store.DB.ExecContext(ctx, `DROP TABLE system_settings; DELETE FROM zenith_schema_versions; INSERT INTO zenith_schema_versions(version) VALUES (3)`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("v3 to v4 migration: %v", err)
	}
	if err := store.DB.QueryRowContext(ctx, `SELECT MAX(version) FROM zenith_schema_versions`).Scan(&version); err != nil || version != foundationSchemaVersion {
		t.Fatalf("upgraded schema version = %d: %v", version, err)
	}
	if _, err := store.DB.ExecContext(ctx, `INSERT INTO system_settings(module, version, data, updated_at) VALUES ('files', 1, '{}', now())`); err != nil {
		t.Fatalf("upgraded settings table unusable: %v", err)
	}
}

func TestPostgresAuthPositionAndTenantIsolation(t *testing.T) {
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required for integration tests")
	}
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
	login := call("POST", "/api/v1/auth/login", map[string]any{"username": username, "password": password, "tenantCode": "", "captchaId": id, "captchaAnswer": string(match[1])}, nil, "")
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
	code := fmt.Sprintf("p%d", time.Now().UnixNano())
	created := call("POST", "/api/v1/positions", map[string]any{"name": "测试岗位", "code": code, "status": "enabled"}, cookie, csrf)
	if created.Code != 201 {
		t.Fatalf("create position: %d %s", created.Code, created.Body.String())
	}
	positionID := int(read(created)["id"].(float64))
	if detail := call("GET", fmt.Sprintf("/api/v1/positions/%d", positionID), nil, cookie, ""); detail.Code != 200 {
		t.Fatalf("position detail: %d %s", detail.Code, detail.Body.String())
	}
	tenantCode := fmt.Sprintf("t%d", time.Now().UnixNano())
	createdTenant := call("POST", "/api/v1/tenants", map[string]any{"name": "测试租户", "code": tenantCode, "status": "enabled"}, cookie, csrf)
	if createdTenant.Code != 201 {
		t.Fatalf("create tenant: %d %s", createdTenant.Code, createdTenant.Body.String())
	}
	tenantID := int(read(createdTenant)["id"].(float64))
	view := call("PUT", "/api/v1/auth/tenant-view", map[string]any{"tenantId": tenantID}, cookie, csrf)
	if view.Code != 200 {
		t.Fatalf("switch tenant: %d %s", view.Code, view.Body.String())
	}
	if hidden := call("GET", fmt.Sprintf("/api/v1/positions/%d", positionID), nil, cookie, ""); hidden.Code != 404 {
		t.Fatalf("cross tenant position exposed: %d %s", hidden.Code, hidden.Body.String())
	}
	roleResponse := call("POST", "/api/v1/roles", map[string]any{"name": "测试租户管理员", "code": "tenant_admin_test", "status": "enabled", "dataScope": "all"}, cookie, csrf)
	if roleResponse.Code != 200 {
		t.Fatalf("create role: %d %s", roleResponse.Code, roleResponse.Body.String())
	}
	roleID := int(read(roleResponse)["id"].(float64))
	menuResponse := call("GET", "/api/v1/menus/flat", nil, cookie, "")
	if menuResponse.Code != 200 {
		t.Fatalf("menu catalog: %d %s", menuResponse.Code, menuResponse.Body.String())
	}
	var catalog struct {
		Data []struct {
			ID         int    `json:"id"`
			Permission string `json:"permission"`
		} `json:"data"`
	}
	if err := json.Unmarshal(menuResponse.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	var listMenuID, createMenuID, userListMenuID int
	for _, item := range catalog.Data {
		if item.Permission == "system:position:list" {
			listMenuID = item.ID
		}
		if item.Permission == "system:position:create" {
			createMenuID = item.ID
		}
		if item.Permission == "system:user:list" {
			userListMenuID = item.ID
		}
	}
	if listMenuID == 0 || createMenuID == 0 || userListMenuID == 0 {
		t.Fatal("missing seeded position permissions")
	}
	assigned := call("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", roleID), map[string]any{"menuIds": []int{listMenuID}}, cookie, csrf)
	if assigned.Code != 200 {
		t.Fatalf("assign menu: %d %s", assigned.Code, assigned.Body.String())
	}
	memberName := fmt.Sprintf("member_%d", time.Now().UnixNano())
	memberPassword := "tenant-member-password-123"
	createdMember := call("POST", "/api/v1/users", map[string]any{"username": memberName, "nickname": "Tenant Member", "password": memberPassword, "status": "enabled", "roleIds": []int{roleID}}, cookie, csrf)
	if createdMember.Code != 200 {
		t.Fatalf("create member: %d %s", createdMember.Code, createdMember.Body.String())
	}
	memberID := int(read(createdMember)["id"].(float64))
	memberCaptcha := call("GET", "/api/v1/auth/captcha", nil, nil, "")
	memberChallenge := read(memberCaptcha)
	memberSVG, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(memberChallenge["image"].(string), "data:image/svg+xml;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	memberAnswer := regexp.MustCompile(`>([A-F0-9]{6})</text>`).FindSubmatch(memberSVG)
	if len(memberAnswer) != 2 {
		t.Fatal("member captcha missing answer")
	}
	memberLogin := call("POST", "/api/v1/auth/login", map[string]any{"username": memberName, "password": memberPassword, "tenantCode": tenantCode, "captchaId": memberChallenge["captchaId"], "captchaAnswer": string(memberAnswer[1])}, nil, "")
	if memberLogin.Code != 200 {
		t.Fatalf("member login: %d %s", memberLogin.Code, memberLogin.Body.String())
	}
	var memberCookie *http.Cookie
	for _, candidate := range memberLogin.Result().Cookies() {
		if candidate.Name == "zenith_session" {
			memberCookie = candidate
		}
	}
	if memberCookie == nil {
		t.Fatal("missing member cookie")
	}
	memberCSRF := read(memberLogin)["csrfToken"].(string)
	if allowed := call("GET", "/api/v1/positions", nil, memberCookie, ""); allowed.Code != 200 {
		t.Fatalf("role list permission: %d %s", allowed.Code, allowed.Body.String())
	}
	if denied := call("POST", "/api/v1/positions", map[string]any{"name": "Forbidden", "code": "forbidden", "status": "enabled"}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("ungranted operation accepted: %d", denied.Code)
	}
	assigned = call("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", roleID), map[string]any{"menuIds": []int{listMenuID, createMenuID}}, cookie, csrf)
	if assigned.Code != 200 {
		t.Fatalf("grant create menu: %d %s", assigned.Code, assigned.Body.String())
	}
	memberPositionCode := fmt.Sprintf("mp%d", time.Now().UnixNano())
	if allowed := call("POST", "/api/v1/positions", map[string]any{"name": "Member Position", "code": memberPositionCode, "status": "enabled"}, memberCookie, memberCSRF); allowed.Code != 201 {
		t.Fatalf("permission grant not immediate: %d %s", allowed.Code, allowed.Body.String())
	}
	disabled := call("PUT", fmt.Sprintf("/api/v1/roles/%d", roleID), map[string]any{"status": "disabled"}, cookie, csrf)
	if disabled.Code != 200 {
		t.Fatalf("disable role: %d %s", disabled.Code, disabled.Body.String())
	}
	if denied := call("GET", "/api/v1/positions", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("disabled role still authorizes: %d", denied.Code)
	}
	directGrant := call("PUT", fmt.Sprintf("/api/v1/users/%d/menus", memberID), map[string]any{"menuIds": []int{listMenuID, userListMenuID}}, cookie, csrf)
	if directGrant.Code != 200 {
		t.Fatalf("direct menu grant: %d %s", directGrant.Code, directGrant.Body.String())
	}
	if allowed := call("GET", "/api/v1/positions", nil, memberCookie, ""); allowed.Code != 200 {
		t.Fatalf("direct grant not immediate: %d %s", allowed.Code, allowed.Body.String())
	}
	otherName := fmt.Sprintf("other_%d", time.Now().UnixNano())
	other := call("POST", "/api/v1/users", map[string]any{"username": otherName, "nickname": "Other Tenant User", "password": "other-tenant-password-123", "status": "enabled"}, cookie, csrf)
	if other.Code != 200 {
		t.Fatalf("create second tenant user: %d %s", other.Code, other.Body.String())
	}
	selfList := call("GET", "/api/v1/users", nil, memberCookie, "")
	if selfList.Code != 200 || int(read(selfList)["total"].(float64)) != 1 {
		t.Fatalf("self scope did not filter users: %d %s", selfList.Code, selfList.Body.String())
	}
	wideScope := call("PUT", fmt.Sprintf("/api/v1/users/%d/data-permission", memberID), map[string]any{"dataScope": "all", "deptScopeIds": []int{}}, cookie, csrf)
	if wideScope.Code != 200 {
		t.Fatalf("set direct data scope: %d %s", wideScope.Code, wideScope.Body.String())
	}
	allList := call("GET", "/api/v1/users", nil, memberCookie, "")
	if allList.Code != 200 || int(read(allList)["total"].(float64)) != 2 {
		t.Fatalf("direct data scope not immediate: %d %s", allList.Code, allList.Body.String())
	}
	removeDirectList := call("PUT", fmt.Sprintf("/api/v1/users/%d/menus", memberID), map[string]any{"menuIds": []int{userListMenuID}}, cookie, csrf)
	if removeDirectList.Code != 200 {
		t.Fatalf("remove direct list: %d %s", removeDirectList.Code, removeDirectList.Body.String())
	}
	if denied := call("GET", "/api/v1/positions", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("direct grant revocation delayed: %d", denied.Code)
	}
	groupRole := call("POST", "/api/v1/roles", map[string]any{"name": "用户组岗位角色", "code": "group_position_role", "status": "enabled", "dataScope": "self"}, cookie, csrf)
	if groupRole.Code != 200 {
		t.Fatalf("create group role: %d %s", groupRole.Code, groupRole.Body.String())
	}
	groupRoleID := int(read(groupRole)["id"].(float64))
	groupGrant := call("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", groupRoleID), map[string]any{"menuIds": []int{listMenuID}}, cookie, csrf)
	if groupGrant.Code != 200 {
		t.Fatalf("grant group role: %d %s", groupGrant.Code, groupGrant.Body.String())
	}
	group := call("POST", "/api/v1/user-groups", map[string]any{"name": "岗位用户组", "code": "position_group", "status": "enabled", "memberMode": "static", "roleIds": []int{groupRoleID}, "userIds": []int{memberID}}, cookie, csrf)
	if group.Code != 200 {
		t.Fatalf("create user group: %d %s", group.Code, group.Body.String())
	}
	groupID := int(read(group)["id"].(float64))
	if allowed := call("GET", "/api/v1/positions", nil, memberCookie, ""); allowed.Code != 200 {
		t.Fatalf("group role not inherited: %d %s", allowed.Code, allowed.Body.String())
	}
	disabledGroup := call("PUT", fmt.Sprintf("/api/v1/user-groups/%d", groupID), map[string]any{"status": "disabled"}, cookie, csrf)
	if disabledGroup.Code != 200 {
		t.Fatalf("disable group: %d %s", disabledGroup.Code, disabledGroup.Body.String())
	}
	if denied := call("GET", "/api/v1/positions", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("disabled group still authorizes: %d", denied.Code)
	}
	dictionary := call("POST", "/api/v1/dicts", map[string]any{"name": "测试状态", "code": "test_status", "status": "enabled"}, cookie, csrf)
	if dictionary.Code != 200 {
		t.Fatalf("create dictionary: %d %s", dictionary.Code, dictionary.Body.String())
	}
	dictID := int(read(dictionary)["id"].(float64))
	item := call("POST", fmt.Sprintf("/api/v1/dicts/%d/items", dictID), map[string]any{"label": "启用", "value": "enabled", "status": "enabled", "sort": 1}, cookie, csrf)
	if item.Code != 200 {
		t.Fatalf("create dictionary item: %d %s", item.Code, item.Body.String())
	}
	itemsByCode := call("GET", "/api/v1/dicts/code/test_status/items", nil, memberCookie, "")
	if itemsByCode.Code != 200 {
		t.Fatalf("read tenant dictionary: %d %s", itemsByCode.Code, itemsByCode.Body.String())
	}
	var itemResult struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(itemsByCode.Body.Bytes(), &itemResult); err != nil || len(itemResult.Data) != 1 {
		t.Fatalf("dictionary item count: %v %s", err, itemsByCode.Body.String())
	}
	storageRoot := t.TempDir()
	storage := call("POST", "/api/v1/file-storage-configs", map[string]any{"name": "测试磁盘", "provider": "local", "status": "enabled", "isDefault": true, "localRootPath": storageRoot}, cookie, csrf)
	if storage.Code != 200 {
		t.Fatalf("create local storage: %d %s", storage.Code, storage.Body.String())
	}
	upload := func(visibility, name string, payload []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(payload); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "http://zenith.test/api/v1/files/upload-one?visibility="+visibility, &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Origin", "http://zenith.test")
		req.Header.Set("X-CSRF-Token", csrf)
		req.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	message := []byte("hello from postgres integration")
	mimeSetting := read(call("GET", "/api/v1/settings/files", nil, cookie, ""))
	mimeVersion := int(mimeSetting["version"].(float64))
	mimeValues := mimeSetting["effective"].(map[string]any)
	previousTypes := mimeValues["uploadAllowedTypes"]
	mimeValues["uploadAllowedTypes"] = []string{"image/*"}
	if changed := call("PUT", "/api/v1/settings/files", map[string]any{"version": mimeVersion, "data": mimeValues}, cookie, csrf); changed.Code != 200 {
		t.Fatalf("restrict MIME policy: %d %s", changed.Code, changed.Body.String())
	}
	if rejected := upload("restricted", "hello.txt", message); rejected.Code != 400 {
		t.Fatalf("MIME policy bypassed: %d %s", rejected.Code, rejected.Body.String())
	}
	mimeValues["uploadAllowedTypes"] = previousTypes
	if restored := call("PUT", "/api/v1/settings/files", map[string]any{"version": mimeVersion + 1, "data": mimeValues}, cookie, csrf); restored.Code != 200 {
		t.Fatalf("restore MIME policy: %d %s", restored.Code, restored.Body.String())
	}
	privateUpload := upload("restricted", "hello.txt", message)
	if privateUpload.Code != 200 {
		t.Fatalf("private upload: %d %s", privateUpload.Code, privateUpload.Body.String())
	}
	privateID := read(privateUpload)["id"].(string)
	if publicAccess := call("GET", "/api/v1/files/"+privateID+"/content", nil, nil, ""); publicAccess.Code != 404 {
		t.Fatalf("private file exposed publicly: %d", publicAccess.Code)
	}
	if otherAccess := call("GET", "/api/v1/files/"+privateID+"/private-content", nil, memberCookie, ""); otherAccess.Code != 403 {
		t.Fatalf("private file exposed to tenant member: %d %s", otherAccess.Code, otherAccess.Body.String())
	}
	if ownAccess := call("GET", "/api/v1/files/"+privateID+"/private-content", nil, cookie, ""); ownAccess.Code != 200 || ownAccess.Body.String() != "hello from postgres integration" {
		t.Fatalf("owner download: %d %s", ownAccess.Code, ownAccess.Body.String())
	}
	publicUpload := upload("public", "hello.txt", message)
	if publicUpload.Code != 200 {
		t.Fatalf("public upload: %d %s", publicUpload.Code, publicUpload.Body.String())
	}
	if disguised := upload("public", "fake.png", bytes.Repeat([]byte{0xff}, 1024)); disguised.Code != 400 {
		t.Fatalf("unrecognized file type was accepted: %d %s", disguised.Code, disguised.Body.String())
	}
	publicID := read(publicUpload)["id"].(string)
	if publicAccess := call("GET", "/api/v1/files/"+publicID+"/content", nil, nil, ""); publicAccess.Code != 200 {
		t.Fatalf("public download: %d %s", publicAccess.Code, publicAccess.Body.String())
	}
	secretFile := filepath.Join(t.TempDir(), "outside-secret.txt")
	if err := os.WriteFile(secretFile, []byte("outside storage root"), 0600); err != nil {
		t.Fatal(err)
	}
	publicObject := filepath.Join(storageRoot, filepath.FromSlash(read(publicUpload)["objectKey"].(string)))
	if err := os.Remove(publicObject); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secretFile, publicObject); err != nil {
		t.Fatal(err)
	}
	if escaped := call("GET", "/api/v1/files/"+publicID+"/content", nil, nil, ""); escaped.Code == 200 || strings.Contains(escaped.Body.String(), "outside storage root") {
		t.Fatalf("storage symlink escaped root: %d %s", escaped.Code, escaped.Body.String())
	}
	if stats := call("GET", "/api/v1/files/stats", nil, cookie, ""); stats.Code != 200 || int(read(stats)["summary"].(map[string]any)["totalFiles"].(float64)) != 2 {
		t.Fatalf("file stats: %d %s", stats.Code, stats.Body.String())
	}
	if removed := call("DELETE", "/api/v1/files/"+privateID, nil, cookie, csrf); removed.Code != 200 {
		t.Fatalf("delete private file: %d %s", removed.Code, removed.Body.String())
	}
	if gone := call("GET", "/api/v1/files/"+privateID+"/private-content", nil, cookie, ""); gone.Code != 404 {
		t.Fatalf("deleted file accessible: %d", gone.Code)
	}
	chunkBytes := bytes.Repeat([]byte("z"), 6*1024*1024)
	started := call("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "chunked.bin", "fileSize": len(chunkBytes), "chunkSize": 5 * 1024 * 1024, "visibility": "restricted"}, cookie, csrf)
	if started.Code != 200 {
		t.Fatalf("chunk init: %d %s", started.Code, started.Body.String())
	}
	uploadID := read(started)["uploadId"].(string)
	for index := 0; index < 2; index++ {
		start := index * 5 * 1024 * 1024
		end := start + 5*1024*1024
		if end > len(chunkBytes) {
			end = len(chunkBytes)
		}
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("uploadId", uploadID)
		_ = writer.WriteField("index", fmt.Sprint(index))
		part, err := writer.CreateFormFile("chunk", "chunked.bin")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(chunkBytes[start:end]); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "http://zenith.test/api/v1/files/upload/chunk", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Origin", "http://zenith.test")
		req.Header.Set("X-CSRF-Token", csrf)
		req.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != 200 {
			t.Fatalf("chunk %d: %d %s", index, response.Code, response.Body.String())
		}
	}
	status := call("GET", "/api/v1/files/upload/"+uploadID+"/status", nil, cookie, "")
	if status.Code != 200 || len(read(status)["received"].([]any)) != 2 {
		t.Fatalf("chunk status: %d %s", status.Code, status.Body.String())
	}
	completed := call("POST", "/api/v1/files/upload/complete", map[string]any{"uploadId": uploadID}, cookie, csrf)
	if completed.Code != 200 {
		t.Fatalf("chunk complete: %d %s", completed.Code, completed.Body.String())
	}
	chunkedID := read(completed)["id"].(string)
	if exposed := call("GET", "/api/v1/files/"+chunkedID+"/content", nil, nil, ""); exposed.Code != 404 {
		t.Fatalf("chunked private file exposed: %d", exposed.Code)
	}
	if downloaded := call("GET", "/api/v1/files/"+chunkedID+"/private-content", nil, cookie, ""); downloaded.Code != 200 || !bytes.Equal(downloaded.Body.Bytes(), chunkBytes) {
		t.Fatalf("chunked download: %d size %d", downloaded.Code, downloaded.Body.Len())
	}
	abortStart := call("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "aborted.bin", "fileSize": 0, "chunkSize": 5 * 1024 * 1024}, cookie, csrf)
	if abortStart.Code != 200 {
		t.Fatalf("abort init: %d %s", abortStart.Code, abortStart.Body.String())
	}
	abortID := read(abortStart)["uploadId"].(string)
	if aborted := call("DELETE", "/api/v1/files/upload/"+abortID, nil, cookie, csrf); aborted.Code != 200 {
		t.Fatalf("abort upload: %d %s", aborted.Code, aborted.Body.String())
	}
	logout := call("POST", "/api/v1/auth/logout", map[string]any{}, cookie, csrf)
	if logout.Code != 200 {
		t.Fatalf("logout: %d %s", logout.Code, logout.Body.String())
	}
	if stale := call("GET", "/api/v1/auth/me", nil, cookie, ""); stale.Code != 401 {
		t.Fatalf("revoked session usable: %d", stale.Code)
	}
}
