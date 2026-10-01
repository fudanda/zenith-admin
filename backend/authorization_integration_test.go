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

	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
)

type apiFixture struct {
	t        *testing.T
	f        *Framework
	cookie   *http.Cookie
	csrf     string
	password string
}

func newAPIFixture(t *testing.T) *apiFixture {
	t.Helper()
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required")
	}
	dsn = isolatedTestDSN(t, dsn)
	s, err := OpenStore(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	password, _ := secret()
	if err = s.InitAdmin(context.Background(), "integration-admin", password); err != nil {
		t.Fatal(err)
	}
	s.Close()
	f, err := New(context.Background(), Config{DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Shutdown(context.Background()) })
	fixture := &apiFixture{t: t, f: f, password: password}
	fixture.cookie, fixture.csrf = fixture.login("integration-admin", password, "192.0.2.1")
	return fixture
}
func (a *apiFixture) call(method, path string, body any, cookie *http.Cookie, csrf, ip string) *httptest.ResponseRecorder {
	a.t.Helper()
	raw, _ := json.Marshal(body)
	if body == nil {
		raw = nil
	}
	req := httptest.NewRequest(method, "http://zenith.test"+path, bytes.NewReader(raw))
	req.RemoteAddr = ip + ":12345"
	req.Header.Set("Origin", "http://zenith.test")
	req.Header.Set("X-CSRF-Token", csrf)
	req.Header.Set("User-Agent", "Mozilla/5.0 Windows Chrome/140.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	a.f.Handler().ServeHTTP(response, req)
	if response.Code >= 200 && response.Code < 300 && strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
		var value any
		if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
			a.t.Fatal("invalid response JSON")
		}
		bestID, bestScore := "", -1
		for id, operation := range contracts.Operations {
			if operation.Method != method {
				continue
			}
			pattern := strings.Split(operation.Path, "/")
			actual := strings.Split(req.URL.Path, "/")
			if len(pattern) != len(actual) {
				continue
			}
			score := 0
			matched := true
			for i, part := range pattern {
				if strings.HasPrefix(part, "{") {
					continue
				}
				if part != actual[i] {
					matched = false
					break
				}
				score++
			}
			if matched && score > bestScore {
				bestID = id
				bestScore = score
			}
		}
		if definition, ok := contracts.RequestDefinitions[bestID]; ok && definition.Response != nil {
			if response.Code != definition.SuccessStatus {
				a.t.Fatalf("%s success status %d differs from shared OpenAPI %d", bestID, response.Code, definition.SuccessStatus)
			}
			if err := definition.Response.Validate(value); err != nil {
				a.t.Fatalf("%s response violates shared contract: %v", bestID, err)
			}
		}
	}
	return response
}
func fixtureData(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope struct{ Data map[string]any }
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}
func (a *apiFixture) login(username, password, ip string) (*http.Cookie, string) {
	a.t.Helper()
	response := a.call("GET", "/api/v1/auth/captcha", nil, nil, "", ip)
	data := fixtureData(a.t, response)
	svg, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(data["image"].(string), "data:image/svg+xml;base64,"))
	answer := regexp.MustCompile(`>([A-F0-9]{4,8})</text>`).FindSubmatch(svg)
	body := map[string]any{"username": username, "password": password}
	if data["enabled"] == true {
		if len(answer) != 2 {
			a.t.Fatal("captcha challenge missing")
		}
		body["captchaId"] = data["captchaId"]
		body["captchaAnswer"] = string(answer[1])
	}
	response = a.call("POST", "/api/v1/auth/login", body, nil, "", ip)
	if response.Code != 200 {
		a.t.Fatalf("login failed: %d %s", response.Code, response.Body.String())
	}
	data = fixtureData(a.t, response)
	if _, ok := data["csrfToken"]; !ok {
		a.t.Fatalf("session missing: %s", response.Body.String())
	}
	return response.Result().Cookies()[0], data["csrfToken"].(string)
}
func (a *apiFixture) admin(method, path string, body any) map[string]any {
	a.t.Helper()
	response := a.call(method, path, body, a.cookie, a.csrf, "192.0.2.1")
	if response.Code != 200 && response.Code != 201 {
		a.t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
	}
	if strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
		return fixtureData(a.t, response)
	}
	return nil
}
func (a *apiFixture) menuID(permission string) int {
	a.t.Helper()
	row, err := a.f.Store.Client.Menu.Query().Where(menu.PermissionEQ(permission)).First(context.Background())
	if err != nil {
		a.t.Fatalf("permission %s: %v", permission, err)
	}
	return row.ID
}

func TestSingleOrganizationAuthorization(t *testing.T) {
	a := newAPIFixture(t)
	dept := a.admin("POST", "/api/v1/departments", map[string]any{"name": "研发部", "code": "rd"})
	deptID := int(dept["id"].(float64))
	other := a.admin("POST", "/api/v1/departments", map[string]any{"name": "财务部", "code": "finance"})
	otherID := int(other["id"].(float64))
	actorRole := a.admin("POST", "/api/v1/roles", map[string]any{"name": "受限管理员", "code": "limited_admin", "dataScope": "custom", "deptScopeIds": []int{deptID}})
	rid := int(actorRole["id"].(float64))
	permissions := []string{"system:user:list", "system:user:update", "system:user:assign", "system:role:list", "system:role:assign", "system:user-groups:list", "system:user-groups:assign"}
	ids := []int{}
	for _, permission := range permissions {
		ids = append(ids, a.menuID(permission))
	}
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", rid), map[string]any{"menuIds": ids})
	actor := a.admin("POST", "/api/v1/users", map[string]any{"username": "limited", "nickname": "受限", "password": "Password123!", "departmentId": deptID, "roleIds": []int{rid}})
	uid := int(actor["id"].(float64))
	hidden := a.admin("POST", "/api/v1/users", map[string]any{"username": "hidden", "nickname": "隐藏成员", "password": "Password123!", "departmentId": otherID})
	hid := int(hidden["id"].(float64))
	cookie, csrf := a.login("limited", "Password123!", "192.0.2.2")
	check := func(method, path string, body any, status int) {
		t.Helper()
		response := a.call(method, path, body, cookie, csrf, "192.0.2.2")
		if response.Code != status {
			t.Fatalf("%s %s: %d expected %d %s", method, path, response.Code, status, response.Body.String())
		}
	}
	check("GET", fmt.Sprintf("/api/v1/users/%d", hid), nil, 404)
	check("PUT", fmt.Sprintf("/api/v1/users/%d", hid), map[string]any{"nickname": "denied"}, 404)
	check("PUT", fmt.Sprintf("/api/v1/users/%d/menus", uid), map[string]any{"menuIds": []int{a.menuID("system:user:create")}}, 403)
	check("PUT", fmt.Sprintf("/api/v1/users/%d/data-permission", uid), map[string]any{"dataScope": "all", "deptScopeIds": []int{}}, 403)
	elevated := a.admin("POST", "/api/v1/roles", map[string]any{"name": "高权限", "code": "elevated", "dataScope": "all"})
	eid := int(elevated["id"].(float64))
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", eid), map[string]any{"menuIds": []int{a.menuID("system:user:create")}})
	check("PUT", fmt.Sprintf("/api/v1/users/%d/roles", uid), map[string]any{"roleIds": []int{eid}}, 403)
	check("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"roleIds": []int{eid}}, 400)
	memberRole := a.admin("POST", "/api/v1/roles", map[string]any{"name": "成员角色", "code": "member_role", "dataScope": "self"})
	mid := int(memberRole["id"].(float64))
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/users", mid), map[string]any{"userIds": []int{uid, hid}})
	check("PUT", fmt.Sprintf("/api/v1/roles/%d/users", mid), map[string]any{"userIds": []int{}}, 200)
	members := a.admin("GET", fmt.Sprintf("/api/v1/roles/%d/member-preview", mid), nil)
	if members["total"].(float64) != 1 {
		t.Fatalf("hidden member removed: %#v", members)
	}
	group := a.admin("POST", "/api/v1/user-groups", map[string]any{"name": "手工组", "code": "manual", "userIds": []int{uid}, "roleIds": []int{mid}})
	gid := int(group["id"].(float64))
	effective := a.admin("GET", fmt.Sprintf("/api/v1/users/%d/effective-permissions", uid), nil)
	if len(effective["inheritedRoles"].([]any)) != 1 {
		t.Fatalf("group inheritance missing: %#v", effective)
	}
	a.admin("PUT", fmt.Sprintf("/api/v1/user-groups/%d", gid), map[string]any{"status": "disabled"})
	effective = a.admin("GET", fmt.Sprintf("/api/v1/users/%d/effective-permissions", uid), nil)
	if len(effective["inheritedRoles"].([]any)) != 0 {
		t.Fatal("disabled group still inherited")
	}
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d", rid), map[string]any{"status": "disabled"})
	check("GET", "/api/v1/users", nil, 403)
	a.admin("DELETE", fmt.Sprintf("/api/v1/sessions/user/%d", uid), nil)
	check("GET", "/api/v1/auth/me", nil, 401)
}

func TestPasswordLoginAndSessionPolicies(t *testing.T) {
	a := newAPIFixture(t)
	settings := a.admin("GET", "/api/v1/settings/identity-security", nil)
	value := settings["effective"].(map[string]any)
	value["password"].(map[string]any)["minLength"] = 12
	value["password"].(map[string]any)["requireUppercase"] = true
	a.admin("PUT", "/api/v1/settings/identity-security", map[string]any{"version": settings["version"], "data": value})
	denied := a.call("POST", "/api/v1/users", map[string]any{"username": "weak", "nickname": "weak", "password": "short"}, a.cookie, a.csrf, "192.0.2.1")
	if denied.Code != 400 {
		t.Fatal("password policy ignored")
	}
	account := a.admin("POST", "/api/v1/users", map[string]any{"username": "policy", "nickname": "策略用户", "password": "Password123!"})
	uid := int(account["id"].(float64))
	auth := a.admin("GET", "/api/v1/settings/auth", nil)
	authValue := auth["effective"].(map[string]any)
	authValue["captchaEnabled"] = false
	a.admin("PUT", "/api/v1/settings/auth", map[string]any{"version": auth["version"], "data": authValue})
	settings = a.admin("GET", "/api/v1/settings/identity-security", nil)
	value = settings["effective"].(map[string]any)
	value["loginChallenge"].(map[string]any)["maxAttemptsPerSource"] = 1
	value["session"].(map[string]any)["maxSessions"] = 1
	a.admin("PUT", "/api/v1/settings/identity-security", map[string]any{"version": settings["version"], "data": value})
	response := a.call("POST", "/api/v1/auth/login", map[string]any{"username": "policy", "password": "bad"}, nil, "", "192.0.2.2")
	if response.Code != 401 {
		t.Fatal("bad credentials not rejected")
	}
	response = a.call("POST", "/api/v1/auth/login", map[string]any{"username": "policy", "password": "Password123!"}, nil, "", "192.0.2.2")
	if fixtureData(t, response)["captchaRequired"] != true {
		t.Fatal("login defense not applied")
	}
	a.admin("POST", fmt.Sprintf("/api/v1/users/%d/unlock", uid), nil)
	first, _ := a.login("policy", "Password123!", "192.0.2.2")
	second, _ := a.login("policy", "Password123!", "192.0.2.3")
	if a.call("GET", "/api/v1/auth/me", nil, first, "", "192.0.2.2").Code != 401 {
		t.Fatal("oldest session not revoked")
	}
	settings = a.admin("GET", "/api/v1/settings/identity-security", nil)
	value = settings["effective"].(map[string]any)
	value["session"].(map[string]any)["exceedAction"] = "reject-new"
	a.admin("PUT", "/api/v1/settings/identity-security", map[string]any{"version": settings["version"], "data": value})
	response = a.call("POST", "/api/v1/auth/login", map[string]any{"username": "policy", "password": "Password123!"}, nil, "", "192.0.2.4")
	data := fixtureData(t, response)
	if data["sessionConflict"] != true {
		t.Fatalf("session conflict missing: %s", response.Body.String())
	}
	ticket := data["ticket"].(string)
	response = a.call("POST", "/api/v1/auth/session-conflict/resolve", map[string]any{"ticket": ticket}, nil, "", "192.0.2.4")
	if response.Code != 200 {
		t.Fatalf("ticket rejected: %s", response.Body.String())
	}
	if a.call("GET", "/api/v1/auth/me", nil, second, "", "192.0.2.3").Code != 401 {
		t.Fatal("ticket did not revoke other sessions")
	}
	if a.call("POST", "/api/v1/auth/session-conflict/resolve", map[string]any{"ticket": ticket}, nil, "", "192.0.2.4").Code != 400 {
		t.Fatal("ticket reusable")
	}
}
