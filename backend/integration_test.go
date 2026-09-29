//go:build integration

package zenith

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

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
	logout := call("POST", "/api/v1/auth/logout", map[string]any{}, cookie, csrf)
	if logout.Code != 200 {
		t.Fatalf("logout: %d %s", logout.Code, logout.Body.String())
	}
	if stale := call("GET", "/api/v1/auth/me", nil, cookie, ""); stale.Code != 401 {
		t.Fatalf("revoked session usable: %d", stale.Code)
	}
}
