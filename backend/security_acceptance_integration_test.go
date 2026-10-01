//go:build integration

package zenith

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestDepartmentScopeAndDynamicGroupInheritance(t *testing.T) {
	a := newAPIFixture(t)
	parent := a.admin("POST", "/api/v1/departments", map[string]any{"name": "parent", "code": "parent"})
	pid := int(parent["id"].(float64))
	child := a.admin("POST", "/api/v1/departments", map[string]any{"name": "child", "code": "child", "parentId": pid})
	cid := int(child["id"].(float64))
	outside := a.admin("POST", "/api/v1/departments", map[string]any{"name": "outside", "code": "outside"})
	oid := int(outside["id"].(float64))
	role := a.admin("POST", "/api/v1/roles", map[string]any{"name": "read", "code": "read", "dataScope": "self"})
	rid := int(role["id"].(float64))
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", rid), map[string]any{"menuIds": []int{a.menuID("system:user:list")}})
	actor := a.admin("POST", "/api/v1/users", map[string]any{"username": "scope_actor", "nickname": "actor", "password": "StrongPass123!", "departmentId": pid, "roleIds": []int{rid}})
	uid := int(actor["id"].(float64))
	a.admin("POST", "/api/v1/users", map[string]any{"username": "scope_child", "nickname": "child", "password": "StrongPass123!", "departmentId": cid})
	a.admin("POST", "/api/v1/users", map[string]any{"username": "scope_other", "nickname": "other", "password": "StrongPass123!", "departmentId": oid})
	cookie, csrf := a.login("scope_actor", "StrongPass123!", "192.0.2.12")
	count := func(expected int) {
		t.Helper()
		response := a.call("GET", "/api/v1/users?keyword=scope_", nil, cookie, csrf, "192.0.2.12")
		a.expect(response, 200)
		if fixtureData(t, response)["total"].(float64) != float64(expected) {
			t.Fatal("data scope mismatch", response.Body.String())
		}
	}
	scope := func(value string, departments []int) {
		a.admin("PUT", fmt.Sprintf("/api/v1/users/%d/data-permission", uid), map[string]any{"dataScope": value, "deptScopeIds": departments})
	}
	count(1)
	scope("dept", []int{})
	count(2)
	scope("dept_only", []int{})
	count(1)
	scope("custom", []int{oid})
	count(1)
	wide := a.admin("POST", "/api/v1/roles", map[string]any{"name": "all", "code": "all_scope", "dataScope": "all"})
	wid := int(wide["id"].(float64))
	group := a.admin("POST", "/api/v1/user-groups", map[string]any{"name": "dynamic", "code": "dynamic", "memberMode": "dynamic", "memberRule": map[string]any{"departmentIds": []int{pid}, "includeSubDepartments": true}, "roleIds": []int{wid}})
	gid := int(group["id"].(float64))
	count(3)
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d", wid), map[string]any{"status": "disabled"})
	count(1)
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d", wid), map[string]any{"status": "enabled"})
	count(3)
	a.admin("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"departmentId": oid})
	count(2)
	members := a.admin("GET", fmt.Sprintf("/api/v1/user-groups/%d/member-preview", gid), nil)
	if members["total"].(float64) != 1 {
		t.Fatal("dynamic membership did not update", members)
	}
}

func TestDynamicMembershipCannotEscalateThroughOrganizationWrites(t *testing.T) {
	a := newAPIFixture(t)
	position := a.admin("POST", "/api/v1/positions", map[string]any{"name": "privileged", "code": "privileged"})
	pid := int(position["id"].(float64))
	limited := a.admin("POST", "/api/v1/roles", map[string]any{"name": "editor", "code": "editor", "dataScope": "self"})
	rid := int(limited["id"].(float64))
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", rid), map[string]any{"menuIds": []int{a.menuID("system:user:update"), a.menuID("system:position:update")}})
	account := a.admin("POST", "/api/v1/users", map[string]any{"username": "dynamic_editor", "nickname": "editor", "password": "StrongPass123!", "roleIds": []int{rid}})
	uid := int(account["id"].(float64))
	privileged := a.admin("POST", "/api/v1/roles", map[string]any{"name": "file manager", "code": "file_manager", "dataScope": "all"})
	prid := int(privileged["id"].(float64))
	a.admin("PUT", fmt.Sprintf("/api/v1/roles/%d/menus", prid), map[string]any{"menuIds": []int{a.menuID("system:file:list")}})
	group := a.admin("POST", "/api/v1/user-groups", map[string]any{"name": "position privilege", "code": "position_privilege", "memberMode": "dynamic", "memberRule": map[string]any{"positionIds": []int{pid}}, "roleIds": []int{prid}})
	gid := int(group["id"].(float64))
	cookie, csrf := a.login("dynamic_editor", "StrongPass123!", "192.0.2.21")
	a.expect(a.call("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"positionIds": []int{pid}}, cookie, csrf, "192.0.2.21"), 409)
	a.expect(a.call("PUT", fmt.Sprintf("/api/v1/positions/%d/members", pid), map[string]any{"userIds": []int{uid}}, cookie, csrf, "192.0.2.21"), 400)
	members := a.admin("GET", fmt.Sprintf("/api/v1/user-groups/%d/member-preview", gid), nil)
	if members["total"].(float64) != 0 {
		t.Fatal("denied organization mutation retained privileged membership")
	}
	a.expect(a.call("GET", "/api/v1/files", nil, cookie, csrf, "192.0.2.21"), 403)
	a.expect(a.call("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"nickname": "edited"}, cookie, csrf, "192.0.2.21"), 200)
	a.admin("PUT", fmt.Sprintf("/api/v1/positions/%d/members", pid), map[string]any{"userIds": []int{uid}})
	a.expect(a.call("GET", "/api/v1/files", nil, cookie, csrf, "192.0.2.21"), 200)
}

func TestReenabledAccountDoesNotRestoreRevokedSession(t *testing.T) {
	a := newAPIFixture(t)
	account := a.admin("POST", "/api/v1/users", map[string]any{"username": "reenable", "nickname": "reenable", "password": "StrongPass123!"})
	uid := int(account["id"].(float64))
	cookie, csrf := a.login("reenable", "StrongPass123!", "192.0.2.22")
	a.admin("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"status": "disabled"})
	a.expect(a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.22"), 401)
	a.admin("PUT", fmt.Sprintf("/api/v1/users/%d", uid), map[string]any{"status": "enabled"})
	a.expect(a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.22"), 401)
	cookie, csrf = a.login("reenable", "StrongPass123!", "192.0.2.22")
	a.expect(a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.22"), 200)
}

func TestAdminInitializationUsesTheSavedPasswordPolicy(t *testing.T) {
	a := newAPIFixture(t)
	settings := a.admin("GET", "/api/v1/settings/identity-security", nil)
	value := settings["effective"].(map[string]any)
	password := value["password"].(map[string]any)
	password["minLength"], password["requireUppercase"], password["requireSpecialChar"] = 18, true, true
	a.admin("PUT", "/api/v1/settings/identity-security", map[string]any{"version": settings["version"], "data": value})
	if err := a.f.Store.InitAdmin(context.Background(), "weak_cli", "lowercasepassword12345"); err == nil {
		t.Fatal("CLI initialization bypassed the saved password policy")
	}
	if err := a.f.Store.InitAdmin(context.Background(), "strong_cli", "ValidInitialization123!"); err != nil {
		t.Fatal(err)
	}
	cookie, csrf := a.login("strong_cli", "ValidInitialization123!", "192.0.2.23")
	a.expect(a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.23"), 200)
}

func TestRepeatSeedPreservesCustomMenusAndDictionaryEdits(t *testing.T) {
	a := newAPIFixture(t)
	custom := a.admin("POST", "/api/v1/menus", map[string]any{"title": "自定义查询按钮", "type": "button", "permission": "system:user:list"})
	id := int(custom["id"].(float64))
	var editedItemID int
	if err := a.f.Store.DB.QueryRowContext(context.Background(), "SELECT id FROM dict_items WHERE value = 'enabled' ORDER BY id LIMIT 1").Scan(&editedItemID); err != nil {
		t.Fatal(err)
	}
	if err := a.f.Store.Client.DictItem.UpdateOneID(editedItemID).SetLabel("保留编辑后的标签").Exec(context.Background()); err != nil {
		t.Fatal(err)
	}
	before, err := a.f.Store.Client.Menu.Query().Count(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := a.f.Store.Seed(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	after, err := a.f.Store.Client.Menu.Query().Count(context.Background())
	if err != nil || before != after {
		t.Fatal("repeat seed duplicated menus")
	}
	row, err := a.f.Store.Client.Menu.Get(context.Background(), id)
	if err != nil || row.Title != "自定义查询按钮" || row.ParentID != 0 {
		t.Fatal("seed replaced a custom button")
	}
	editedItem, err := a.f.Store.Client.DictItem.Get(context.Background(), editedItemID)
	if err != nil || editedItem.Label != "保留编辑后的标签" {
		t.Fatal("repeat seed replaced an edited dictionary item")
	}
	for _, code := range []string{"common_status", "menu_type", "menu_visible", "user_gender", "department_category"} {
		response := a.call("GET", "/api/v1/dicts/code/"+code+"/items", nil, a.cookie, a.csrf, "192.0.2.1")
		a.expect(response, 200)
		if response.Body.String() == "" || !strings.Contains(response.Body.String(), "value") {
			t.Fatalf("missing original dictionary %s", code)
		}
	}
}

func TestRestartExpiryAndDatabaseFailure(t *testing.T) {
	a := newAPIFixture(t)
	account := a.admin("POST", "/api/v1/users", map[string]any{"username": "expiry_user", "nickname": "expiry", "password": "StrongPass123!"})
	uid := int(account["id"].(float64))
	settings := a.admin("GET", "/api/v1/settings/identity-security", nil)
	value := settings["effective"].(map[string]any)
	value["password"].(map[string]any)["expiryEnabled"] = true
	value["password"].(map[string]any)["expiryDays"] = 1
	a.admin("PUT", "/api/v1/settings/identity-security", map[string]any{"version": settings["version"], "data": value})
	a.f.Store.Client.User.UpdateOneID(uid).SetPasswordUpdatedAt(time.Now().Add(-48 * time.Hour)).Exec(context.Background())
	cookie, csrf := a.login("expiry_user", "StrongPass123!", "192.0.2.13")
	a.expect(a.call("PUT", "/api/v1/auth/profile", map[string]any{"nickname": "forbidden"}, cookie, csrf, "192.0.2.13"), 403)
	dsn := a.f.config.DSN
	a.f.Shutdown(context.Background())
	replacement, err := New(context.Background(), Config{DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	a.f = replacement
	t.Cleanup(func() { replacement.Shutdown(context.Background()) })
	restored := a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.13")
	a.expect(restored, 200)
	if fixtureData(t, restored)["user"].(map[string]any)["requirePasswordChange"] != true {
		t.Fatal("expiry ignored")
	}
	a.expect(a.call("PUT", "/api/v1/auth/password", map[string]any{"oldPassword": "StrongPass123!", "newPassword": "ChangedPass123!"}, cookie, csrf, "192.0.2.13"), 200)
	a.expect(a.call("GET", "/api/v1/auth/me", nil, cookie, csrf, "192.0.2.13"), 401)
	cookie, csrf = a.login("expiry_user", "ChangedPass123!", "192.0.2.13")
	a.f.Store.DB.Close()
	for _, path := range []string{"/api/v1/auth/me", "/api/v1/auth/captcha", "/api/v1/health", "/api/v1/ready"} {
		a.expect(a.call("GET", path, nil, cookie, csrf, "192.0.2.13"), 503)
	}
}
