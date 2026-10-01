package zenith

import (
	"net/http"
	"sort"
	"strconv"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/userdepartmentscope"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
)

func sortedIDs(set map[int]bool) []int {
	ids := make([]int, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func (f *Framework) userEffectivePermissions(w http.ResponseWriter, r *http.Request) {
	account, _, ok := f.userGrantTarget(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	direct, roleMenus, groupMenus := map[int]bool{}, map[int]bool{}, map[int]bool{}
	userDepts, roleDepts, groupDepts := map[int]bool{}, map[int]bool{}, map[int]bool{}
	sources := map[string][]string{}
	rolesScopes, groupScopes := []string{}, []string{}
	groups := make([]map[string]any, 0)
	inherited := map[int]map[string]any{}
	collect := func(id int, menus, depts map[int]bool, scopes *[]string, source string) error {
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
		if ent.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		*scopes = append(*scopes, row.DataScope)
		links, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(id)).All(ctx)
		if err != nil {
			return err
		}
		for _, link := range links {
			menus[link.MenuID] = true
			sources[strconv.Itoa(link.MenuID)] = append(sources[strconv.Itoa(link.MenuID)], source)
		}
		if row.DataScope == "custom" {
			links, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(id)).All(ctx)
			if err != nil {
				return err
			}
			for _, link := range links {
				depts[link.DepartmentID] = true
			}
		}
		return nil
	}
	load := func() error {
		links, err := f.Store.Client.UserMenu.Query().Where(usermenu.UserIDEQ(account.ID)).All(ctx)
		if err != nil {
			return err
		}
		for _, link := range links {
			direct[link.MenuID] = true
			sources[strconv.Itoa(link.MenuID)] = []string{"直接授权"}
		}
		depts, err := f.Store.Client.UserDepartmentScope.Query().Where(userdepartmentscope.UserIDEQ(account.ID)).All(ctx)
		if err != nil {
			return err
		}
		for _, link := range depts {
			userDepts[link.DepartmentID] = true
		}
		roles, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).All(ctx)
		if err != nil {
			return err
		}
		for _, link := range roles {
			if err = collect(link.RoleID, roleMenus, roleDepts, &rolesScopes, "角色授权"); err != nil {
				return err
			}
		}
		memberships, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.UserIDEQ(account.ID)).All(ctx)
		if err != nil {
			return err
		}
		for _, member := range memberships {
			group, err := f.Store.Client.UserGroup.Get(ctx, member.GroupID)
			if err != nil {
				return err
			}
			if group.Status != "enabled" {
				continue
			}
			links, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).All(ctx)
			if err != nil {
				return err
			}
			if len(links) > 0 {
				groups = append(groups, map[string]any{"id": group.ID, "name": group.Name})
			}
			for _, link := range links {
				row, err := f.Store.Client.Role.Get(ctx, link.RoleID)
				if err != nil {
					return err
				}
				if row.Status != "enabled" {
					continue
				}
				if err = collect(row.ID, groupMenus, groupDepts, &groupScopes, "用户组: "+group.Name); err != nil {
					return err
				}
				if inherited[row.ID] == nil {
					inherited[row.ID] = map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "groupNames": []string{}}
				}
				names := inherited[row.ID]["groupNames"].([]string)
				inherited[row.ID]["groupNames"] = append(names, group.Name)
			}
		}
		return nil
	}
	if err := load(); err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	allMenus := map[int]bool{}
	for _, set := range []map[int]bool{direct, roleMenus, groupMenus} {
		for id := range set {
			allMenus[id] = true
		}
	}
	scopes := append(append([]string{}, rolesScopes...), groupScopes...)
	if account.UserDataScope != nil {
		scopes = append(scopes, *account.UserDataScope)
	}
	effective := "self"
	if value := widestScope(scopes); value != nil {
		effective = *value
	}
	allDepts := map[int]bool{}
	if effective == "custom" {
		for _, set := range []map[int]bool{userDepts, roleDepts, groupDepts} {
			for id := range set {
				allDepts[id] = true
			}
		}
	}
	inheritedList := make([]map[string]any, 0, len(inherited))
	for _, id := range sortedMapKeys(inherited) {
		inheritedList = append(inheritedList, inherited[id])
	}
	respond(w, 200, map[string]any{"directMenuIds": sortedIDs(direct), "roleMenuIds": sortedIDs(roleMenus), "groupMenuIds": sortedIDs(groupMenus), "effectiveMenuIds": sortedIDs(allMenus), "userDataScope": account.UserDataScope, "roleDataScope": widestScope(rolesScopes), "groupDataScope": widestScope(groupScopes), "effectiveDataScope": effective, "userDeptScopeIds": sortedIDs(userDepts), "roleDeptScopeIds": sortedIDs(roleDepts), "groupDeptScopeIds": sortedIDs(groupDepts), "effectiveDeptScopeIds": sortedIDs(allDepts), "groups": groups, "inheritedRoles": inheritedList, "menuSources": sources})
}
func sortedMapKeys(values map[int]map[string]any) []int {
	keys := make([]int, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Ints(keys)
	return keys
}
