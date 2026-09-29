package zenith

import (
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/userdepartmentscope"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/gorilla/mux"
	"net/http"
)

func (f *Framework) userGrantTarget(w http.ResponseWriter, r *http.Request) (*ent.User, int, bool) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return nil, 0, false
	}
	account, err := f.scopedUser(r, fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "账号不存在或超出管理范围")
		return nil, 0, false
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return nil, 0, false
	}
	return account, id, true
}

func (f *Framework) getUserMenus(w http.ResponseWriter, r *http.Request) {
	account, _, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	direct, err := f.Store.Client.UserMenu.Query().Where(usermenu.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	directIDs := make([]int, 0, len(direct))
	for _, item := range direct {
		directIDs = append(directIDs, item.MenuID)
	}
	assignments, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	inherited := map[int]bool{}
	for _, assignment := range assignments {
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(assignment.RoleID), role.StatusEQ("enabled")).Only(r.Context())
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		if (row.TenantID == nil) != (account.TenantID == nil) || row.TenantID != nil && *row.TenantID != *account.TenantID {
			continue
		}
		links, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(row.ID)).All(r.Context())
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		for _, link := range links {
			inherited[link.MenuID] = true
		}
	}
	roleIDs := make([]int, 0, len(inherited))
	for id := range inherited {
		roleIDs = append(roleIDs, id)
	}
	respond(w, 200, map[string]any{"directMenuIds": directIDs, "roleMenuIds": roleIDs})
}

func (f *Framework) assignUserMenus(w http.ResponseWriter, r *http.Request) {
	account, id, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	var in struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err := decode(r, &in); err != nil || in.MenuIDs == nil || len(in.MenuIDs) > 5000 {
		fail(w, 400, "invalid_request", "菜单列表无效")
		return
	}
	seen := map[int]bool{}
	for _, menuID := range in.MenuIDs {
		if menuID < 1 || seen[menuID] {
			fail(w, 400, "invalid_request", "菜单 ID 无效或重复")
			return
		}
		seen[menuID] = true
		if _, err := f.Store.Client.Menu.Query().Where(menu.IDEQ(menuID), menu.StatusEQ("enabled")).Only(r.Context()); err != nil {
			fail(w, 400, "invalid_menu", "菜单不可授权")
			return
		}
	}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.UserMenu.Delete().Where(usermenu.UserIDEQ(account.ID)).Exec(r.Context()); err != nil {
			return err
		}
		for _, menuID := range in.MenuIDs {
			if err := tx.UserMenu.Create().SetUserID(account.ID).SetMenuID(menuID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("assign_menus").SetResource("users").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "授权失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) assignUserRoles(w http.ResponseWriter, r *http.Request) {
	account, id, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	var in struct {
		RoleIDs []int `json:"roleIds"`
	}
	if err := decode(r, &in); err != nil || in.RoleIDs == nil || len(in.RoleIDs) > 5000 {
		fail(w, 400, "invalid_request", "角色列表无效")
		return
	}
	p := fromContext(r.Context())
	seen := map[int]bool{}
	for _, roleID := range in.RoleIDs {
		if roleID < 1 || seen[roleID] {
			fail(w, 400, "invalid_request", "角色 ID 无效或重复")
			return
		}
		seen[roleID] = true
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(roleID), role.StatusEQ("enabled")).Only(r.Context())
		if err != nil || (row.TenantID == nil) != (account.TenantID == nil) || row.TenantID != nil && *row.TenantID != *account.TenantID {
			fail(w, 400, "invalid_role", "角色不属于当前租户")
			return
		}
		if row.Code == "super_admin" {
			fail(w, 403, "protected_role", "超级管理员不能通过页面分配")
			return
		}
	}
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.UserRole.Delete().Where(userrole.UserIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		for _, roleID := range in.RoleIDs {
			if err := tx.UserRole.Create().SetUserID(id).SetRoleID(roleID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("assign_roles").SetResource("users").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "分配失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) getUserDataPermission(w http.ResponseWriter, r *http.Request) {
	account, _, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	links, err := f.Store.Client.UserDepartmentScope.Query().Where(userdepartmentscope.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	ids := make([]int, 0, len(links))
	for _, link := range links {
		ids = append(ids, link.DepartmentID)
	}
	directScopes := []string{}
	directDepts := map[int]bool{}
	groupScopes := []string{}
	groupDepts := map[int]bool{}
	collect := func(roleID int, scopes *[]string, depts map[int]bool) error {
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(roleID), role.StatusEQ("enabled")).Only(r.Context())
		if ent.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if (row.TenantID == nil) != (account.TenantID == nil) || row.TenantID != nil && *row.TenantID != *account.TenantID {
			return nil
		}
		*scopes = append(*scopes, row.DataScope)
		if row.DataScope == "custom" {
			links, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(roleID)).All(r.Context())
			if err != nil {
				return err
			}
			for _, link := range links {
				depts[link.DepartmentID] = true
			}
		}
		return nil
	}
	directRoles, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	for _, link := range directRoles {
		if err := collect(link.RoleID, &directScopes, directDepts); err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
	}
	memberships, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.UserIDEQ(account.ID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	groups := make([]any, 0, len(memberships))
	for _, membership := range memberships {
		group, err := f.Store.Client.UserGroup.Get(r.Context(), membership.GroupID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		if group.Status != "enabled" || (group.TenantID == nil) != (account.TenantID == nil) || group.TenantID != nil && *group.TenantID != *account.TenantID {
			continue
		}
		groups = append(groups, map[string]any{"id": group.ID, "name": group.Name})
		groupRoles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).All(r.Context())
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		for _, link := range groupRoles {
			if err := collect(link.RoleID, &groupScopes, groupDepts); err != nil {
				fail(w, 503, "database_unavailable", "查询失败")
				return
			}
		}
	}
	roleDeptIDs := make([]int, 0, len(directDepts))
	for id := range directDepts {
		roleDeptIDs = append(roleDeptIDs, id)
	}
	groupDeptIDs := make([]int, 0, len(groupDepts))
	for id := range groupDepts {
		groupDeptIDs = append(groupDeptIDs, id)
	}
	respond(w, 200, map[string]any{"userDataScope": account.UserDataScope, "deptScopeIds": ids,
		"roleDataScope": widestScope(directScopes), "roleDeptScopeIds": roleDeptIDs, "groupDataScope": widestScope(groupScopes), "groupDeptScopeIds": groupDeptIDs, "groups": groups})
}

func widestScope(scopes []string) *string {
	priority := map[string]int{"self": 1, "dept_only": 2, "custom": 3, "dept": 4, "all": 5}
	var result *string
	for _, scope := range scopes {
		if result == nil || priority[scope] > priority[*result] {
			value := scope
			result = &value
		}
	}
	return result
}

func (f *Framework) updateUserDataPermission(w http.ResponseWriter, r *http.Request) {
	_, id, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	var in struct {
		DataScope    *string `json:"dataScope"`
		DeptScopeIDs []int   `json:"deptScopeIds"`
	}
	if err := decode(r, &in); err != nil || in.DeptScopeIDs == nil || len(in.DeptScopeIDs) > 5000 {
		fail(w, 400, "invalid_request", "数据范围无效")
		return
	}
	if in.DataScope != nil && !dataScopes[*in.DataScope] {
		fail(w, 400, "invalid_scope", "数据范围无效")
		return
	}
	p := fromContext(r.Context())
	seen := map[int]bool{}
	for _, deptID := range in.DeptScopeIDs {
		if deptID < 1 || seen[deptID] {
			fail(w, 400, "invalid_department", "部门 ID 无效或重复")
			return
		}
		seen[deptID] = true
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(deptID), departmentScope(p)).Only(r.Context()); err != nil {
			fail(w, 400, "invalid_department", "部门不属于当前租户")
			return
		}
	}
	if (in.DataScope == nil || *in.DataScope != "custom") && len(in.DeptScopeIDs) > 0 {
		fail(w, 400, "invalid_scope", "仅自定义范围可以指定部门")
		return
	}
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		update := tx.User.UpdateOneID(id)
		if in.DataScope == nil {
			update.ClearUserDataScope()
		} else {
			update.SetUserDataScope(*in.DataScope)
		}
		if err := update.Exec(r.Context()); err != nil {
			return err
		}
		if _, err := tx.UserDepartmentScope.Delete().Where(userdepartmentscope.UserIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		if in.DataScope != nil && *in.DataScope == "custom" {
			for _, deptID := range in.DeptScopeIDs {
				if err := tx.UserDepartmentScope.Create().SetUserID(id).SetDepartmentID(deptID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("set_data_scope").SetResource("users").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	respond(w, 200, nil)
}
