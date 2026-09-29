//go:build integration

package zenith

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
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
	// Recreate the committed v5 state, then test its additive group migration.
	if _, err := store.DB.ExecContext(ctx, `ALTER TABLE user_groups DROP COLUMN member_rule, DROP COLUMN rule_synced_at; DELETE FROM zenith_schema_versions; INSERT INTO zenith_schema_versions(version) VALUES (5)`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("v5 to v6 migration: %v", err)
	}
	if _, err := store.DB.ExecContext(ctx, `INSERT INTO user_groups(name, code, member_rule, rule_synced_at, created_at, updated_at) VALUES ('v6-group', 'v6-group', '{"includeUserIds":[1]}', now(), now(), now())`); err != nil {
		t.Fatalf("upgraded group columns unusable: %v", err)
	}
	// Recreate the committed v4 state to verify the additive menu migration.
	if _, err := store.DB.ExecContext(ctx, `ALTER TABLE menus DROP COLUMN query, DROP COLUMN is_external, DROP COLUMN embed, DROP COLUMN keep_alive; ALTER TABLE user_groups DROP COLUMN member_rule, DROP COLUMN rule_synced_at; DELETE FROM zenith_schema_versions; INSERT INTO zenith_schema_versions(version) VALUES (4)`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("v4 to v6 migration: %v", err)
	}
	if err := store.DB.QueryRowContext(ctx, `SELECT MAX(version) FROM zenith_schema_versions`).Scan(&version); err != nil || version != foundationSchemaVersion {
		t.Fatalf("upgraded schema version = %d: %v", version, err)
	}
	if _, err := store.DB.ExecContext(ctx, `INSERT INTO menus(title, type, query, is_external, embed, keep_alive, created_at, updated_at) VALUES ('v5-menu', 'menu', 'q=1', true, false, true, now(), now())`); err != nil {
		t.Fatalf("upgraded menu columns unusable: %v", err)
	}
	// Version 3 predates the settings table and both additive migrations.
	if _, err := store.DB.ExecContext(ctx, `DROP TABLE system_settings; ALTER TABLE menus DROP COLUMN query, DROP COLUMN is_external, DROP COLUMN embed, DROP COLUMN keep_alive; ALTER TABLE user_groups DROP COLUMN member_rule, DROP COLUMN rule_synced_at; DELETE FROM zenith_schema_versions; INSERT INTO zenith_schema_versions(version) VALUES (3)`); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("v3 to v6 migration: %v", err)
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
	adminID := int(read(login)["user"].(map[string]any)["id"].(float64))
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
	tenantCode := fmt.Sprintf("t%d", time.Now().UnixNano())
	createdTenant := call("POST", "/api/v1/tenants", map[string]any{"name": "测试租户", "code": tenantCode, "status": "enabled", "contactName": "Alice", "contactPhone": "13812345678"}, cookie, csrf)
	if createdTenant.Code != 201 {
		t.Fatalf("create tenant: %d %s", createdTenant.Code, createdTenant.Body.String())
	}
	tenantID := int(read(createdTenant)["id"].(float64))
	tenantFilter := "/api/v1/tenants?keyword=" + tenantCode + "&status=enabled"
	if listed := call("GET", tenantFilter, nil, cookie, ""); listed.Code != 200 || read(listed)["total"].(float64) != 1 {
		t.Fatalf("tenant list filter: %d %s", listed.Code, listed.Body.String())
	}
	tenantCSV := call("GET", "/api/v1/tenants/export?keyword="+tenantCode+"&status=enabled", nil, cookie, "")
	if tenantCSV.Code != 200 || !strings.HasPrefix(tenantCSV.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("tenant CSV response: %d %s", tenantCSV.Code, tenantCSV.Body.String())
	}
	tenantRows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(tenantCSV.Body.String(), "\ufeff"))).ReadAll()
	if err != nil || len(tenantRows) != 2 || tenantRows[1][2] != tenantCode || tenantRows[1][4] != "***" || strings.Contains(tenantCSV.Body.String(), "13812345678") {
		t.Fatalf("tenant CSV filtered/masked: %v %#v", err, tenantRows)
	}
	if empty := call("GET", "/api/v1/tenants/export?keyword="+tenantCode+"&status=disabled", nil, cookie, ""); empty.Code != 200 || strings.Contains(empty.Body.String(), tenantCode) {
		t.Fatalf("tenant CSV status filter: %d %s", empty.Code, empty.Body.String())
	}
	if invalid := call("GET", "/api/v1/tenants/export?status=invalid", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid tenant CSV status accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	packageOne := call("POST", "/api/v1/tenant-packages", map[string]any{"name": "测试套餐一", "status": "enabled", "quotas": map[string]any{"maxUsers": 1}, "features": []string{}}, cookie, csrf)
	if packageOne.Code != 200 {
		t.Fatalf("create package: %d %s", packageOne.Code, packageOne.Body.String())
	}
	packageOneID := int(read(packageOne)["id"].(float64))
	packageTwo := call("POST", "/api/v1/tenant-packages", map[string]any{"name": "测试套餐二", "status": "disabled", "features": []string{}}, cookie, csrf)
	if packageTwo.Code != 200 {
		t.Fatalf("create second package: %d %s", packageTwo.Code, packageTwo.Body.String())
	}
	packageTwoID := int(read(packageTwo)["id"].(float64))
	if filtered := call("GET", "/api/v1/tenant-packages?keyword=测试套餐&status=disabled", nil, cookie, ""); filtered.Code != 200 || read(filtered)["total"].(float64) != 1 {
		t.Fatalf("package status filter: %d %s", filtered.Code, filtered.Body.String())
	}
	if invalid := call("GET", "/api/v1/tenant-packages?status=invalid", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid package status accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if invalid := call("POST", "/api/v1/tenant-packages", map[string]any{"name": "错误配额", "status": "enabled", "quotas": map[string]any{"maxUsers": -1}}, cookie, csrf); invalid.Code != 400 {
		t.Fatalf("invalid package quota accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if invalid := call("POST", "/api/v1/tenant-packages", map[string]any{"name": "过大配额", "status": "enabled", "quotas": map[string]any{"maxUsers": 1e20}}, cookie, csrf); invalid.Code != 400 {
		t.Fatalf("oversized package quota accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	boundTenant := call("POST", "/api/v1/tenants", map[string]any{"name": "绑定套餐的租户", "code": tenantCode + "b", "status": "enabled", "packageId": packageOneID, "maxUsers": 2}, cookie, csrf)
	if boundTenant.Code != 201 {
		t.Fatalf("create package-bound tenant: %d %s", boundTenant.Code, boundTenant.Body.String())
	}
	boundTenantID := int(read(boundTenant)["id"].(float64))
	if bound := call("DELETE", fmt.Sprintf("/api/v1/tenant-packages/%d", packageOneID), nil, cookie, csrf); bound.Code != 409 {
		t.Fatalf("bound package deleted: %d %s", bound.Code, bound.Body.String())
	}
	if bound := call("DELETE", "/api/v1/tenant-packages/batch", map[string]any{"ids": []int{packageOneID, packageTwoID}}, cookie, csrf); bound.Code != 409 {
		t.Fatalf("bound package batch deleted: %d %s", bound.Code, bound.Body.String())
	}
	if preserved := call("GET", fmt.Sprintf("/api/v1/tenant-packages/%d", packageTwoID), nil, cookie, ""); preserved.Code != 200 {
		t.Fatalf("package batch did not roll back: %d %s", preserved.Code, preserved.Body.String())
	}
	if removed := call("DELETE", "/api/v1/tenant-packages/batch", map[string]any{"ids": []int{packageTwoID}}, cookie, csrf); removed.Code != 200 {
		t.Fatalf("delete unbound package: %d %s", removed.Code, removed.Body.String())
	}
	if missing := call("GET", fmt.Sprintf("/api/v1/tenant-packages/%d", packageTwoID), nil, cookie, ""); missing.Code != 404 {
		t.Fatalf("deleted package still readable: %d %s", missing.Code, missing.Body.String())
	}
	if quotaView := call("PUT", "/api/v1/auth/tenant-view", map[string]any{"tenantId": boundTenantID}, cookie, csrf); quotaView.Code != 200 {
		t.Fatalf("switch quota tenant: %d %s", quotaView.Code, quotaView.Body.String())
	}
	quotaPrefix := fmt.Sprintf("quota_%d", time.Now().UnixNano())
	quotaResults := make(chan int, 2)
	for index := 0; index < 2; index++ {
		go func(index int) {
			created := call("POST", "/api/v1/users", map[string]any{"username": fmt.Sprintf("%s_%d", quotaPrefix, index), "nickname": "配额测试", "password": "quota-test-password-123", "status": "enabled"}, cookie, csrf)
			quotaResults <- created.Code
		}(index)
	}
	firstQuota, secondQuota := <-quotaResults, <-quotaResults
	if !((firstQuota == 200 && secondQuota == 409) || (firstQuota == 409 && secondQuota == 200)) {
		t.Fatalf("concurrent tenant seat limit: %d %d", firstQuota, secondQuota)
	}
	if listed := call("GET", "/api/v1/users?keyword="+quotaPrefix, nil, cookie, ""); listed.Code != 200 || read(listed)["total"].(float64) != 1 {
		t.Fatalf("tenant seat count: %d %s", listed.Code, listed.Body.String())
	}
	view := call("PUT", "/api/v1/auth/tenant-view", map[string]any{"tenantId": tenantID}, cookie, csrf)
	if view.Code != 200 {
		t.Fatalf("switch tenant: %d %s", view.Code, view.Body.String())
	}
	if hidden := call("GET", fmt.Sprintf("/api/v1/positions/%d", positionID), nil, cookie, ""); hidden.Code != 404 {
		t.Fatalf("cross tenant position exposed: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("GET", "/api/v1/positions/export?keyword="+code, nil, cookie, ""); hidden.Code != 200 || !strings.Contains(hidden.Body.String(), "岗位名称") || strings.Contains(hidden.Body.String(), code) {
		t.Fatalf("cross tenant CSV leaked position: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("GET", "/api/v1/departments/export?keyword="+platformDepartmentCode, nil, cookie, ""); hidden.Code != 200 || strings.Contains(hidden.Body.String(), platformDepartmentCode) {
		t.Fatalf("cross tenant department CSV leaked: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("GET", "/api/v1/dicts/export?keyword=platform_dict_test", nil, cookie, ""); hidden.Code != 200 || strings.Contains(hidden.Body.String(), "platform_dict_test") {
		t.Fatalf("cross tenant dict CSV leaked: %d %s", hidden.Code, hidden.Body.String())
	}
	tenantDepartmentCode := fmt.Sprintf("td%d", time.Now().UnixNano())
	tenantDepartment := call("POST", "/api/v1/departments", map[string]any{"name": "租户部门", "code": tenantDepartmentCode}, cookie, csrf)
	if tenantDepartment.Code != 200 {
		t.Fatalf("create tenant department: %d %s", tenantDepartment.Code, tenantDepartment.Body.String())
	}
	tenantDepartmentID := int(read(tenantDepartment)["id"].(float64))
	filteredDepartment := call("GET", "/api/v1/departments/flat?keyword="+tenantDepartmentCode+"&status=enabled", nil, cookie, "")
	if filteredDepartment.Code != 200 || !strings.Contains(filteredDepartment.Body.String(), tenantDepartmentCode) || strings.Contains(filteredDepartment.Body.String(), platformDepartmentCode) {
		t.Fatalf("department list filters: %d %s", filteredDepartment.Code, filteredDepartment.Body.String())
	}
	tenantDepartmentCSV := call("GET", "/api/v1/departments/export?keyword="+tenantDepartmentCode+"&status=enabled", nil, cookie, "")
	if tenantDepartmentCSV.Code != 200 || !strings.Contains(tenantDepartmentCSV.Body.String(), tenantDepartmentCode) {
		t.Fatalf("tenant department CSV: %d %s", tenantDepartmentCSV.Code, tenantDepartmentCSV.Body.String())
	}
	if invalid := call("GET", "/api/v1/departments/export?status=invalid", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid department filter accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if hidden := call("GET", "/api/v1/operation-logs?module=positions", nil, cookie, ""); hidden.Code != 200 || read(hidden)["total"].(float64) != 0 {
		t.Fatalf("cross tenant audit leaked: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("GET", "/api/v1/login-logs?userId="+fmt.Sprint(adminID), nil, cookie, ""); hidden.Code != 200 || read(hidden)["total"].(float64) != 0 {
		t.Fatalf("cross tenant login log leaked: %d %s", hidden.Code, hidden.Body.String())
	}
	roleResponse := call("POST", "/api/v1/roles", map[string]any{"name": "测试租户管理员", "code": "tenant_admin_test", "status": "enabled", "dataScope": "all"}, cookie, csrf)
	if roleResponse.Code != 200 {
		t.Fatalf("create role: %d %s", roleResponse.Code, roleResponse.Body.String())
	}
	roleID := int(read(roleResponse)["id"].(float64))
	roleCreatedAt, err := time.Parse(time.RFC3339Nano, read(roleResponse)["createdAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	roleDay := roleCreatedAt.In(time.Local).Format("2006-01-02")
	roleFilter := "/api/v1/roles?keyword=tenant_admin_test&status=enabled&startTime=" + roleDay + "&endTime=" + roleDay
	if filtered := call("GET", roleFilter, nil, cookie, ""); filtered.Code != 200 || read(filtered)["total"].(float64) != 1 {
		t.Fatalf("role list filters: %d %s", filtered.Code, filtered.Body.String())
	}
	roleCSV := call("GET", strings.Replace(roleFilter, "/api/v1/roles?", "/api/v1/roles/export?", 1), nil, cookie, "")
	if roleCSV.Code != 200 || !strings.Contains(roleCSV.Body.String(), "tenant_admin_test") {
		t.Fatalf("tenant role CSV: %d %s", roleCSV.Code, roleCSV.Body.String())
	}
	if hidden := call("GET", "/api/v1/roles/export?keyword=super_admin", nil, cookie, ""); hidden.Code != 200 || strings.Contains(hidden.Body.String(), "super_admin") {
		t.Fatalf("cross tenant role CSV leaked: %d %s", hidden.Code, hidden.Body.String())
	}
	if invalid := call("GET", "/api/v1/roles/export?status=unknown", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid role status accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	auditQuery := fmt.Sprintf("/api/v1/operation-logs?userId=%d&module=roles&description=create", adminID)
	auditLogs := call("GET", auditQuery, nil, cookie, "")
	if auditLogs.Code != 200 || read(auditLogs)["total"].(float64) < 1 {
		t.Fatalf("tenant audit filter: %d %s", auditLogs.Code, auditLogs.Body.String())
	}
	for _, item := range read(auditLogs)["list"].([]any) {
		if int(item.(map[string]any)["tenantId"].(float64)) != tenantID {
			t.Fatalf("tenant audit scope mismatch: %v", item)
		}
	}
	auditCSV := call("GET", fmt.Sprintf("/api/v1/operation-logs/export?userId=%d&module=roles&description=create", adminID), nil, cookie, "")
	if auditCSV.Code != 200 || !strings.Contains(auditCSV.Body.String(), "roles") {
		t.Fatalf("tenant audit CSV: %d %s", auditCSV.Code, auditCSV.Body.String())
	}
	if invalid := call("GET", "/api/v1/operation-logs/export?startTime=2026-09-30&endTime=2026-09-29", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("inverted audit range accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if unsupported := call("GET", "/api/v1/operation-logs?status=success", nil, cookie, ""); unsupported.Code != 400 {
		t.Fatalf("unsupported audit filter ignored: %d %s", unsupported.Code, unsupported.Body.String())
	}
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
	var listMenuID, createMenuID, userListMenuID, userExportMenuID, userUpdateMenuID, userDeleteMenuID int
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
		if item.Permission == "system:user:export" {
			userExportMenuID = item.ID
		}
		if item.Permission == "system:user:update" {
			userUpdateMenuID = item.ID
		}
		if item.Permission == "system:user:delete" {
			userDeleteMenuID = item.ID
		}
	}
	if listMenuID == 0 || createMenuID == 0 || userListMenuID == 0 || userExportMenuID == 0 || userUpdateMenuID == 0 || userDeleteMenuID == 0 {
		t.Fatal("missing seeded position permissions")
	}
	assigned := call("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", roleID), map[string]any{"menuIds": []int{listMenuID}}, cookie, csrf)
	if assigned.Code != 200 {
		t.Fatalf("assign menu: %d %s", assigned.Code, assigned.Body.String())
	}
	memberName := fmt.Sprintf("member_%d", time.Now().UnixNano())
	memberPassword := "tenant-member-password-123"
	createdMember := call("POST", "/api/v1/users", map[string]any{"username": memberName, "nickname": "Tenant Member", "password": memberPassword, "email": "member@example.test", "phone": "13812345679", "departmentId": tenantDepartmentID, "status": "enabled", "roleIds": []int{roleID}}, cookie, csrf)
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
	if denied := call("GET", "/api/v1/tenants/export", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("non-platform tenant export accepted: %d %s", denied.Code, denied.Body.String())
	}
	if denied := call("DELETE", "/api/v1/tenant-packages/batch", map[string]any{"ids": []int{packageOneID}}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("non-platform package delete accepted: %d %s", denied.Code, denied.Body.String())
	}
	if denied := call("GET", "/api/v1/users/export", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("ungranted user export accepted: %d %s", denied.Code, denied.Body.String())
	}
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
	directGrant := call("PUT", fmt.Sprintf("/api/v1/users/%d/menus", memberID), map[string]any{"menuIds": []int{listMenuID, userListMenuID, userExportMenuID, userUpdateMenuID, userDeleteMenuID}}, cookie, csrf)
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
	otherID := int(read(other)["id"].(float64))
	otherChallenge := read(call("GET", "/api/v1/auth/captcha", nil, nil, ""))
	otherSVG, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(otherChallenge["image"].(string), "data:image/svg+xml;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	otherAnswer := regexp.MustCompile(`>([A-F0-9]{6})</text>`).FindSubmatch(otherSVG)
	if len(otherAnswer) != 2 {
		t.Fatal("other captcha missing answer")
	}
	otherLogin := call("POST", "/api/v1/auth/login", map[string]any{"username": otherName, "password": "other-tenant-password-123", "tenantCode": tenantCode, "captchaId": otherChallenge["captchaId"], "captchaAnswer": string(otherAnswer[1])}, nil, "")
	if otherLogin.Code != 200 {
		t.Fatalf("other login: %d %s", otherLogin.Code, otherLogin.Body.String())
	}
	var otherCookie *http.Cookie
	for _, candidate := range otherLogin.Result().Cookies() {
		if candidate.Name == "zenith_session" {
			otherCookie = candidate
		}
	}
	if otherCookie == nil {
		t.Fatal("other session cookie missing")
	}
	selfList := call("GET", "/api/v1/users", nil, memberCookie, "")
	if selfList.Code != 200 || int(read(selfList)["total"].(float64)) != 1 {
		t.Fatalf("self scope did not filter users: %d %s", selfList.Code, selfList.Body.String())
	}
	selfCSV := call("GET", "/api/v1/users/export?keyword="+memberName+"&phone=13812345679&status=enabled", nil, memberCookie, "")
	if selfCSV.Code != 200 || !strings.HasPrefix(selfCSV.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("user CSV response: %d %s", selfCSV.Code, selfCSV.Body.String())
	}
	userRows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(selfCSV.Body.String(), "\ufeff"))).ReadAll()
	if err != nil || len(userRows) != 2 || userRows[1][1] != memberName || userRows[1][5] != "***" || userRows[1][6] != "***" || strings.Contains(selfCSV.Body.String(), "member@example.test") || strings.Contains(selfCSV.Body.String(), "13812345679") {
		t.Fatalf("user CSV filtered/masked: %v %#v", err, userRows)
	}
	memberCreatedAt, err := time.Parse(time.RFC3339Nano, read(createdMember)["createdAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	userDay := memberCreatedAt.In(time.Local).Format("2006-01-02")
	matched := call("GET", fmt.Sprintf("/api/v1/users/export?departmentId=%d&startTime=%s&endTime=%s&keyword=%s", tenantDepartmentID, userDay, userDay, memberName), nil, memberCookie, "")
	if matched.Code != 200 || !strings.Contains(matched.Body.String(), memberName) {
		t.Fatalf("user CSV department/date filter: %d %s", matched.Code, matched.Body.String())
	}
	if empty := call("GET", "/api/v1/users/export?departmentId=999999&keyword="+memberName, nil, memberCookie, ""); empty.Code != 200 || strings.Contains(empty.Body.String(), memberName) {
		t.Fatalf("user CSV department filter ignored: %d %s", empty.Code, empty.Body.String())
	}
	if hidden := call("GET", "/api/v1/users/export?keyword="+otherName, nil, memberCookie, ""); hidden.Code != 200 || strings.Contains(hidden.Body.String(), otherName) {
		t.Fatalf("self scope leaked another account: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("GET", "/api/v1/users/export?keyword="+username, nil, cookie, ""); hidden.Code != 200 || strings.Contains(hidden.Body.String(), username) {
		t.Fatalf("tenant CSV leaked platform account: %d %s", hidden.Code, hidden.Body.String())
	}
	if invalid := call("GET", "/api/v1/users/export?startTime=bad-date", nil, memberCookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid user CSV date accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if invalid := call("GET", "/api/v1/users?status=unknown", nil, memberCookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid user list status accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if hidden := call("PUT", "/api/v1/users/batch-status", map[string]any{"ids": []int{otherID}, "status": "disabled"}, memberCookie, memberCSRF); hidden.Code != 404 {
		t.Fatalf("batch status escaped self scope: %d %s", hidden.Code, hidden.Body.String())
	}
	if hidden := call("DELETE", "/api/v1/users/batch", map[string]any{"ids": []int{otherID}}, memberCookie, memberCSRF); hidden.Code != 404 {
		t.Fatalf("batch delete escaped self scope: %d %s", hidden.Code, hidden.Body.String())
	}
	if protected := call("DELETE", "/api/v1/users/batch", map[string]any{"ids": []int{memberID}}, memberCookie, memberCSRF); protected.Code != 409 {
		t.Fatalf("member deleted own account: %d %s", protected.Code, protected.Body.String())
	}
	wideScope := call("PUT", fmt.Sprintf("/api/v1/users/%d/data-permission", memberID), map[string]any{"dataScope": "all", "deptScopeIds": []int{}}, cookie, csrf)
	if wideScope.Code != 200 {
		t.Fatalf("set direct data scope: %d %s", wideScope.Code, wideScope.Body.String())
	}
	allList := call("GET", "/api/v1/users", nil, memberCookie, "")
	if allList.Code != 200 || int(read(allList)["total"].(float64)) != 2 {
		t.Fatalf("direct data scope not immediate: %d %s", allList.Code, allList.Body.String())
	}
	if visible := call("GET", "/api/v1/users/export?keyword="+otherName, nil, memberCookie, ""); visible.Code != 200 || !strings.Contains(visible.Body.String(), otherName) {
		t.Fatalf("wide scope CSV omitted another account: %d %s", visible.Code, visible.Body.String())
	}
	if changed := call("PUT", "/api/v1/users/batch-status", map[string]any{"ids": []int{otherID}, "status": "disabled"}, memberCookie, memberCSRF); changed.Code != 200 {
		t.Fatalf("wide scope batch status denied: %d %s", changed.Code, changed.Body.String())
	}
	if current := call("GET", fmt.Sprintf("/api/v1/users/%d", otherID), nil, cookie, ""); current.Code != 200 || read(current)["status"] != "disabled" {
		t.Fatalf("batch status not applied: %d %s", current.Code, current.Body.String())
	}
	if revoked := call("GET", "/api/v1/auth/me", nil, otherCookie, ""); revoked.Code != 401 {
		t.Fatalf("batch disable kept session valid: %d %s", revoked.Code, revoked.Body.String())
	}
	if restored := call("PUT", "/api/v1/users/batch-status", map[string]any{"ids": []int{otherID}, "status": "enabled"}, cookie, csrf); restored.Code != 200 {
		t.Fatalf("batch status restore failed: %d %s", restored.Code, restored.Body.String())
	}
	if revoked := call("GET", "/api/v1/auth/me", nil, otherCookie, ""); revoked.Code != 401 {
		t.Fatalf("batch re-enable restored revoked session: %d %s", revoked.Code, revoked.Body.String())
	}
	removeDirectList := call("PUT", fmt.Sprintf("/api/v1/users/%d/menus", memberID), map[string]any{"menuIds": []int{userListMenuID}}, cookie, csrf)
	if removeDirectList.Code != 200 {
		t.Fatalf("remove direct list: %d %s", removeDirectList.Code, removeDirectList.Body.String())
	}
	if denied := call("GET", "/api/v1/positions", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("direct grant revocation delayed: %d", denied.Code)
	}
	if denied := call("PUT", "/api/v1/users/batch-status", map[string]any{"ids": []int{otherID}, "status": "disabled"}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("batch permission revocation delayed: %d %s", denied.Code, denied.Body.String())
	}
	batchIDs := make([]int, 0, 2)
	for index := 0; index < 2; index++ {
		created := call("POST", "/api/v1/users", map[string]any{"username": fmt.Sprintf("batch_%d_%d", time.Now().UnixNano(), index), "nickname": "批量测试", "password": "batch-test-password-123", "status": "enabled"}, cookie, csrf)
		if created.Code != 200 {
			t.Fatalf("create batch target: %d %s", created.Code, created.Body.String())
		}
		batchIDs = append(batchIDs, int(read(created)["id"].(float64)))
	}
	if invalid := call("PUT", "/api/v1/users/batch-status", map[string]any{"ids": []int{batchIDs[0], batchIDs[0]}, "status": "disabled"}, cookie, csrf); invalid.Code != 400 {
		t.Fatalf("duplicate batch IDs accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	if partial := call("DELETE", "/api/v1/users/batch", map[string]any{"ids": []int{batchIDs[0], 999999}}, cookie, csrf); partial.Code != 404 {
		t.Fatalf("partial batch delete accepted: %d %s", partial.Code, partial.Body.String())
	}
	if preserved := call("GET", fmt.Sprintf("/api/v1/users/%d", batchIDs[0]), nil, cookie, ""); preserved.Code != 200 {
		t.Fatalf("partial batch delete did not roll back: %d %s", preserved.Code, preserved.Body.String())
	}
	if removed := call("DELETE", "/api/v1/users/batch", map[string]any{"ids": batchIDs}, cookie, csrf); removed.Code != 200 {
		t.Fatalf("batch delete failed: %d %s", removed.Code, removed.Body.String())
	}
	if missing := call("GET", fmt.Sprintf("/api/v1/users/%d", batchIDs[0]), nil, cookie, ""); missing.Code != 404 {
		t.Fatalf("batch delete left account: %d %s", missing.Code, missing.Body.String())
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
	rule := map[string]any{"includeUserIds": []int{memberID}}
	preview := call("POST", "/api/v1/user-groups/rule-preview", map[string]any{"memberRule": rule}, cookie, csrf)
	if preview.Code != 200 || int(read(preview)["joiningCount"].(float64)) != 1 {
		t.Fatalf("dynamic rule preview: %d %s", preview.Code, preview.Body.String())
	}
	if denied := call("POST", "/api/v1/user-groups/rule-preview", map[string]any{"memberRule": rule}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("rule preview permission bypassed: %d %s", denied.Code, denied.Body.String())
	}
	platformAdminID := int(read(login)["user"].(map[string]any)["id"].(float64))
	if crossTenant := call("POST", "/api/v1/user-groups/rule-preview", map[string]any{"memberRule": map[string]any{"includeUserIds": []int{platformAdminID}}}, cookie, csrf); crossTenant.Code != 400 {
		t.Fatalf("cross-tenant dynamic rule accepted: %d %s", crossTenant.Code, crossTenant.Body.String())
	}
	dynamic := call("POST", "/api/v1/user-groups", map[string]any{"name": "动态岗位用户组", "code": "dynamic_position_group", "status": "enabled", "memberMode": "dynamic", "memberRule": rule, "roleIds": []int{groupRoleID}}, cookie, csrf)
	if dynamic.Code != 200 || int(read(dynamic)["memberCount"].(float64)) != 1 {
		t.Fatalf("create dynamic group: %d %s", dynamic.Code, dynamic.Body.String())
	}
	dynamicID := int(read(dynamic)["id"].(float64))
	if allowed := call("GET", "/api/v1/positions", nil, memberCookie, ""); allowed.Code != 200 {
		t.Fatalf("dynamic group role not inherited: %d %s", allowed.Code, allowed.Body.String())
	}
	if invalid := call("PUT", fmt.Sprintf("/api/v1/user-groups/%d", dynamicID), map[string]any{"memberRule": map[string]any{}}, cookie, csrf); invalid.Code != 400 {
		t.Fatalf("empty dynamic rule accepted: %d %s", invalid.Code, invalid.Body.String())
	}
	updatedDynamic := call("PUT", fmt.Sprintf("/api/v1/user-groups/%d", dynamicID), map[string]any{"memberRule": map[string]any{"includeUserIds": []int{memberID}, "excludeUserIds": []int{memberID}}}, cookie, csrf)
	if updatedDynamic.Code != 200 || int(read(updatedDynamic)["memberCount"].(float64)) != 0 {
		t.Fatalf("dynamic exclusion did not materialize: %d %s", updatedDynamic.Code, updatedDynamic.Body.String())
	}
	if denied := call("GET", "/api/v1/positions", nil, memberCookie, ""); denied.Code != 403 {
		t.Fatalf("dynamic role revocation delayed: %d %s", denied.Code, denied.Body.String())
	}
	if synced := call("POST", fmt.Sprintf("/api/v1/user-groups/%d/sync", dynamicID), nil, cookie, csrf); synced.Code != 200 {
		t.Fatalf("manual dynamic sync: %d %s", synced.Code, synced.Body.String())
	}
	dictionary := call("POST", "/api/v1/dicts", map[string]any{"name": "测试状态", "code": "test_status", "status": "enabled"}, cookie, csrf)
	if dictionary.Code != 200 {
		t.Fatalf("create dictionary: %d %s", dictionary.Code, dictionary.Body.String())
	}
	dictID := int(read(dictionary)["id"].(float64))
	dictCreatedAt, err := time.Parse(time.RFC3339Nano, read(dictionary)["createdAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	dictDay := dictCreatedAt.In(time.Local).Format("2006-01-02")
	dictFilter := "/api/v1/dicts?keyword=test_status&status=enabled&startDate=" + dictDay + "&endDate=" + dictDay
	if filtered := call("GET", dictFilter, nil, cookie, ""); filtered.Code != 200 || read(filtered)["total"].(float64) != 1 {
		t.Fatalf("dict list filters: %d %s", filtered.Code, filtered.Body.String())
	}
	dictCSV := call("GET", strings.Replace(dictFilter, "/api/v1/dicts?", "/api/v1/dicts/export?", 1), nil, cookie, "")
	if dictCSV.Code != 200 || !strings.Contains(dictCSV.Body.String(), "test_status") {
		t.Fatalf("dict CSV: %d %s", dictCSV.Code, dictCSV.Body.String())
	}
	if invalid := call("GET", "/api/v1/dicts/export?startDate=invalid", nil, cookie, ""); invalid.Code != 400 {
		t.Fatalf("invalid dict date accepted: %d %s", invalid.Code, invalid.Body.String())
	}
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
		if runtime.GOOS != "windows" || !errors.Is(err, syscall.Errno(1314)) {
			t.Fatal(err)
		}
		t.Log("Windows symlink privilege unavailable; Linux CI verifies storage escape protection")
		if err := os.WriteFile(publicObject, message, 0600); err != nil {
			t.Fatal(err)
		}
	} else {
		if escaped := call("GET", "/api/v1/files/"+publicID+"/content", nil, nil, ""); escaped.Code == 200 || strings.Contains(escaped.Body.String(), "outside storage root") {
			t.Fatalf("storage symlink escaped root: %d %s", escaped.Code, escaped.Body.String())
		}
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
	if denied := call("POST", "/api/v1/files/batch-download", map[string]any{"ids": []string{publicID}}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("batch download bypassed permission: %d %s", denied.Code, denied.Body.String())
	}
	archiveUpload := upload("public", "archive.txt", message)
	if archiveUpload.Code != 200 {
		t.Fatalf("archive test upload: %d %s", archiveUpload.Code, archiveUpload.Body.String())
	}
	archiveID := read(archiveUpload)["id"].(string)
	archiveResponse := call("POST", "/api/v1/files/batch-download", map[string]any{"ids": []string{archiveID, chunkedID}}, cookie, csrf)
	if archiveResponse.Code != 200 || archiveResponse.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("batch download: %d %s", archiveResponse.Code, archiveResponse.Body.String())
	}
	archive, err := zip.NewReader(bytes.NewReader(archiveResponse.Body.Bytes()), int64(archiveResponse.Body.Len()))
	if err != nil || len(archive.File) != 2 {
		t.Fatalf("batch ZIP invalid: %v", err)
	}
	for _, entry := range archive.File {
		if entry.Name == "chunked.bin" {
			reader, err := entry.Open()
			if err != nil {
				t.Fatal(err)
			}
			content, readErr := io.ReadAll(reader)
			_ = reader.Close()
			if readErr != nil || !bytes.Equal(content, chunkBytes) {
				t.Fatalf("chunked ZIP content: %v", readErr)
			}
		}
	}
	if denied := call("DELETE", "/api/v1/files/batch", map[string]any{"ids": []string{publicID}}, memberCookie, memberCSRF); denied.Code != 403 {
		t.Fatalf("batch file deletion bypassed permission: %d %s", denied.Code, denied.Body.String())
	}
	if duplicate := call("DELETE", "/api/v1/files/batch", map[string]any{"ids": []string{publicID, publicID}}, cookie, csrf); duplicate.Code != 400 {
		t.Fatalf("duplicate batch file IDs accepted: %d %s", duplicate.Code, duplicate.Body.String())
	}
	if removed := call("DELETE", "/api/v1/files/batch", map[string]any{"ids": []string{publicID, chunkedID, archiveID}}, cookie, csrf); removed.Code != 200 {
		t.Fatalf("batch delete files: %d %s", removed.Code, removed.Body.String())
	}
	if gone := call("GET", "/api/v1/files/"+chunkedID+"/private-content", nil, cookie, ""); gone.Code != 404 {
		t.Fatalf("batch-deleted file accessible: %d %s", gone.Code, gone.Body.String())
	}
	if bytes, err := os.ReadFile(secretFile); err != nil || string(bytes) != "outside storage root" {
		t.Fatalf("batch deletion escaped local storage root: %v", err)
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
