package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/gorilla/mux"
)

var roleCodePattern = regexp.MustCompile(`^[a-z_]+$`)
var dataScopes = map[string]bool{"all": true, "custom": true, "dept_only": true, "dept": true, "self": true}

func roleScope(p *principal) predicate.Role {
	if p.TenantID == nil {
		return role.TenantIDIsNil()
	}
	return role.TenantIDEQ(*p.TenantID)
}

func (f *Framework) scopedRole(r *http.Request, p *principal, id int) (*ent.Role, error) {
	return f.Store.Client.Role.Query().Where(role.IDEQ(id), roleScope(p)).Only(r.Context())
}

func (f *Framework) roleView(r *http.Request, row *ent.Role) (map[string]any, error) {
	menus, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(row.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	menuIDs := make([]int, 0, len(menus))
	for _, link := range menus {
		menuIDs = append(menuIDs, link.MenuID)
	}
	departments, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(row.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	deptIDs := make([]int, 0, len(departments))
	for _, link := range departments {
		deptIDs = append(deptIDs, link.DepartmentID)
	}
	users, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(row.ID)).Count(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "status": row.Status, "dataScope": row.DataScope,
		"tenantId": row.TenantID, "menuIds": menuIDs, "deptScopeIds": deptIDs, "userCount": users, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Framework) listRoles(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	q := r.URL.Query()
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	query := f.Store.Client.Role.Query().Where(roleScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(role.Or(role.NameContainsFold(keyword), role.CodeContainsFold(keyword)))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(role.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.roleView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) allRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.Role.Query().Where(roleScope(fromContext(r.Context())), role.StatusEQ("enabled")).Order(ent.Asc(role.FieldName)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.roleView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, list)
}

func (f *Framework) getRole(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.scopedRole(r, fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "角色不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.roleView(r, row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

type roleInput struct {
	Name         string  `json:"name"`
	Code         string  `json:"code"`
	Description  *string `json:"description"`
	Status       string  `json:"status"`
	DataScope    string  `json:"dataScope"`
	DeptScopeIDs []int   `json:"deptScopeIds"`
}

func validateRole(in roleInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("角色名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !roleCodePattern.MatchString(in.Code) {
		return errors.New("角色编码无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if !dataScopes[in.DataScope] {
		return errors.New("数据范围无效")
	}
	if in.Description != nil && len([]rune(*in.Description)) > 256 {
		return errors.New("说明过长")
	}
	return nil
}

func (f *Framework) saveRole(w http.ResponseWriter, r *http.Request) {
	id := 0
	if r.Method == http.MethodPut {
		var err error
		id, err = intParam(mux.Vars(r)["id"])
		if err != nil {
			fail(w, 400, "invalid_id", err.Error())
			return
		}
	}
	p := fromContext(r.Context())
	in := roleInput{Status: "enabled", DataScope: "all", DeptScopeIDs: []int{}}
	if id != 0 {
		current, err := f.scopedRole(r, p, id)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "角色不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		if current.Code == "super_admin" {
			fail(w, 409, "protected_role", "不能修改平台超级管理员角色")
			return
		}
		in = roleInput{Name: current.Name, Code: current.Code, Description: current.Description, Status: current.Status, DataScope: current.DataScope}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "角色内容无效")
		return
	}
	deptChanged := false
	for key, raw := range patch {
		var err error
		switch key {
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "code":
			err = json.Unmarshal(raw, &in.Code)
		case "description":
			err = json.Unmarshal(raw, &in.Description)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		case "dataScope":
			err = json.Unmarshal(raw, &in.DataScope)
		case "deptScopeIds":
			deptChanged = true
			err = json.Unmarshal(raw, &in.DeptScopeIDs)
		default:
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if err := validateRole(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	seen := map[int]bool{}
	for _, departmentID := range in.DeptScopeIDs {
		if departmentID < 1 || seen[departmentID] {
			fail(w, 400, "invalid_department", "部门范围无效")
			return
		}
		seen[departmentID] = true
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(departmentID), departmentScope(p)).Only(r.Context()); err != nil {
			fail(w, 400, "invalid_department", "部门不属于当前租户")
			return
		}
	}
	var saved *ent.Role
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Role.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetDataScope(in.DataScope)
			if p.TenantID != nil {
				create.SetTenantID(*p.TenantID)
			}
			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.Role.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetDataScope(in.DataScope)
			if in.Description == nil {
				update.ClearDescription()
			} else {
				update.SetDescription(*in.Description)
			}
			saved, err = update.Save(r.Context())
		}
		if err != nil {
			return err
		}
		if deptChanged || id == 0 {
			if _, err = tx.RoleDepartment.Delete().Where(roledepartment.RoleIDEQ(saved.ID)).Exec(r.Context()); err != nil {
				return err
			}
			for _, departmentID := range in.DeptScopeIDs {
				if err = tx.RoleDepartment.Create().SetRoleID(saved.ID).SetDepartmentID(departmentID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("roles").SetResourceID(saved.ID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "role_conflict", err.Error())
		return
	}
	view, err := f.roleView(r, saved)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) deleteRole(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	row, err := f.scopedRole(r, p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "角色不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if row.Code == "super_admin" {
		fail(w, 409, "protected_role", "不能删除平台超级管理员角色")
		return
	}
	used, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).Exist(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if used {
		fail(w, 409, "role_in_use", "角色仍有关联账号")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.Role.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("roles").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) roleUsers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedRole(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "角色不存在")
		return
	} else if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	links, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	result := make([]any, 0, len(links))
	for _, link := range links {
		account, err := f.visibleUser(r.Context(), p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		result = append(result, map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname, "email": account.Email, "avatar": account.Avatar, "status": account.Status, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt})
	}
	respond(w, 200, result)
}

func (f *Framework) assignRoleUsers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err = decode(r, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		fail(w, 400, "invalid_request", "用户列表无效")
		return
	}
	p := fromContext(r.Context())
	seen := map[int]bool{}
	for _, userID := range in.UserIDs {
		if userID < 1 || seen[userID] {
			fail(w, 400, "invalid_request", "用户 ID 无效或重复")
			return
		}
		seen[userID] = true
		if _, err := f.visibleUser(r.Context(), p, userID); err != nil {
			fail(w, 400, "invalid_user", "用户不在可管理范围")
			return
		}
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		row, err := tx.Role.Query().Where(role.IDEQ(id), roleScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		if row.Code == "super_admin" {
			return errors.New("不能批量修改超级管理员成员")
		}
		for _, userID := range in.UserIDs {
			account, err := tx.User.Get(r.Context(), userID)
			if err != nil {
				return err
			}
			if !userMatchesTenant(account, p.TenantID) {
				return errors.New("跨租户用户")
			}
		}
		if _, err = tx.UserRole.Delete().Where(userrole.RoleIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		for _, userID := range in.UserIDs {
			if err = tx.UserRole.Create().SetRoleID(id).SetUserID(userID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("assign_users").SetResource("roles").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "角色或用户不存在")
		return
	}
	if err != nil {
		fail(w, 409, "assign_conflict", err.Error())
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) assignRoleMenus(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var in struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err = decode(r, &in); err != nil || in.MenuIDs == nil || len(in.MenuIDs) > 5000 {
		fail(w, 400, "invalid_request", "菜单列表无效")
		return
	}
	p := fromContext(r.Context())
	seen := map[int]bool{}
	for _, menuID := range in.MenuIDs {
		if menuID < 1 || seen[menuID] {
			fail(w, 400, "invalid_request", "菜单 ID 无效或重复")
			return
		}
		seen[menuID] = true
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		row, err := tx.Role.Query().Where(role.IDEQ(id), roleScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		if row.Code == "super_admin" {
			return errors.New("不能修改超级管理员菜单")
		}
		for _, menuID := range in.MenuIDs {
			if _, err = tx.Menu.Query().Where(menu.IDEQ(menuID), menu.StatusEQ("enabled")).Only(r.Context()); err != nil {
				return err
			}
		}
		if _, err = tx.RoleMenu.Delete().Where(rolemenu.RoleIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		for _, menuID := range in.MenuIDs {
			if err = tx.RoleMenu.Create().SetRoleID(id).SetMenuID(menuID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("assign_menus").SetResource("roles").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "角色或菜单不存在")
		return
	}
	if err != nil {
		fail(w, 409, "assign_conflict", err.Error())
		return
	}
	respond(w, 200, nil)
}
