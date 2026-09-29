package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/usergroup"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/gorilla/mux"
)

var groupCodePattern = regexp.MustCompile(`^\w+$`)

func groupScope(p *principal) predicate.UserGroup {
	if p.TenantID == nil {
		return usergroup.TenantIDIsNil()
	}
	return usergroup.TenantIDEQ(*p.TenantID)
}
func (f *Framework) scopedGroup(r *http.Request, p *principal, id int) (*ent.UserGroup, error) {
	return f.Store.Client.UserGroup.Query().Where(usergroup.IDEQ(id), groupScope(p)).Only(r.Context())
}

func (f *Framework) groupView(r *http.Request, row *ent.UserGroup) (map[string]any, error) {
	members, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(row.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	roles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(row.ID)).All(r.Context())
	if err != nil {
		return nil, err
	}
	var ownerName *string
	if row.OwnerID != nil {
		owner, err := f.Store.Client.User.Get(r.Context(), *row.OwnerID)
		if err == nil {
			ownerName = &owner.Nickname
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "ownerId": row.OwnerID, "ownerName": ownerName,
		"memberMode": row.MemberMode, "memberRule": nil, "ruleSyncedAt": nil, "memberCount": len(members), "roleCount": len(roles), "status": row.Status,
		"tenantId": row.TenantID, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Framework) listGroups(w http.ResponseWriter, r *http.Request) {
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
	query := f.Store.Client.UserGroup.Query().Where(groupScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(usergroup.Or(usergroup.NameContainsFold(keyword), usergroup.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			fail(w, 400, "invalid_status", "状态无效")
			return
		}
		query = query.Where(usergroup.StatusEQ(status))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(usergroup.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.groupView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) allGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.UserGroup.Query().Where(groupScope(fromContext(r.Context())), usergroup.StatusEQ("enabled")).Order(ent.Asc(usergroup.FieldName)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.groupView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, list)
}

func (f *Framework) getGroup(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.scopedGroup(r, fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.groupView(r, row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

type groupInput struct {
	Name, Code, Status, MemberMode string
	Description                    *string
	OwnerID                        *int
	RoleIDs, UserIDs               []int
}

func validateGroup(in groupInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("用户组名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !groupCodePattern.MatchString(in.Code) {
		return errors.New("用户组编码无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.MemberMode != "static" {
		return errors.New("首版仅支持手工维护用户组")
	}
	if in.Description != nil && len([]rune(*in.Description)) > 256 {
		return errors.New("说明过长")
	}
	return nil
}

func (f *Framework) validateGroupRoles(r *http.Request, p *principal, ids []int) error {
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return errors.New("角色 ID 无效或重复")
		}
		seen[id] = true
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(r.Context())
		if err != nil {
			return errors.New("角色不存在")
		}
		if (row.TenantID == nil) != (p.TenantID == nil) || row.TenantID != nil && *row.TenantID != *p.TenantID {
			return errors.New("跨租户角色")
		}
		if row.Code == "super_admin" {
			return errors.New("平台超级管理员角色不可分配给用户组")
		}
	}
	return nil
}
func (f *Framework) validateGroupUsers(r *http.Request, p *principal, ids []int) error {
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return errors.New("用户 ID 无效或重复")
		}
		seen[id] = true
		if _, err := f.visibleUser(r.Context(), p, id); err != nil {
			return errors.New("用户不在可管理范围")
		}
	}
	return nil
}

func (f *Framework) saveGroup(w http.ResponseWriter, r *http.Request) {
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
	in := groupInput{Status: "enabled", MemberMode: "static", RoleIDs: []int{}, UserIDs: []int{}}
	if id != 0 {
		current, err := f.scopedGroup(r, p, id)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "用户组不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = groupInput{Name: current.Name, Code: current.Code, Description: current.Description, OwnerID: current.OwnerID, Status: current.Status, MemberMode: current.MemberMode}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "用户组内容无效")
		return
	}
	rolesChanged := false
	usersChanged := false
	for key, raw := range patch {
		var err error
		switch key {
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "code":
			err = json.Unmarshal(raw, &in.Code)
		case "description":
			err = json.Unmarshal(raw, &in.Description)
		case "ownerId":
			err = json.Unmarshal(raw, &in.OwnerID)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		case "memberMode":
			err = json.Unmarshal(raw, &in.MemberMode)
		case "memberRule":
			if string(raw) != "null" {
				fail(w, 400, "unsupported_member_rule", "首版不支持动态成员规则")
				return
			}
		case "roleIds":
			rolesChanged = true
			err = json.Unmarshal(raw, &in.RoleIDs)
		case "userIds":
			usersChanged = true
			err = json.Unmarshal(raw, &in.UserIDs)
		default:
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if err := validateGroup(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if in.OwnerID != nil {
		if _, err := f.visibleUser(r.Context(), p, *in.OwnerID); err != nil {
			fail(w, 400, "invalid_owner", "负责人不在可管理范围")
			return
		}
	}
	if rolesChanged || id == 0 {
		if err := f.validateGroupRoles(r, p, in.RoleIDs); err != nil {
			fail(w, 400, "invalid_role", err.Error())
			return
		}
	}
	if usersChanged || id == 0 {
		if err := f.validateGroupUsers(r, p, in.UserIDs); err != nil {
			fail(w, 400, "invalid_user", err.Error())
			return
		}
	}
	var saved *ent.UserGroup
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.UserGroup.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetMemberMode("static")
			if p.TenantID != nil {
				create.SetTenantID(*p.TenantID)
			}
			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			if in.OwnerID != nil {
				create.SetOwnerID(*in.OwnerID)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.UserGroup.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetMemberMode("static")
			if in.Description == nil {
				update.ClearDescription()
			} else {
				update.SetDescription(*in.Description)
			}
			if in.OwnerID == nil {
				update.ClearOwnerID()
			} else {
				update.SetOwnerID(*in.OwnerID)
			}
			saved, err = update.Save(r.Context())
		}
		if err != nil {
			return err
		}
		if rolesChanged || id == 0 {
			if _, err = tx.UserGroupRole.Delete().Where(usergrouprole.GroupIDEQ(saved.ID)).Exec(r.Context()); err != nil {
				return err
			}
			for _, roleID := range in.RoleIDs {
				if err = tx.UserGroupRole.Create().SetGroupID(saved.ID).SetRoleID(roleID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		if usersChanged || id == 0 {
			if _, err = tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(saved.ID)).Exec(r.Context()); err != nil {
				return err
			}
			for _, userID := range in.UserIDs {
				if err = tx.UserGroupMember.Create().SetGroupID(saved.ID).SetUserID(userID).Exec(r.Context()); err != nil {
					return err
				}
			}
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("user_groups").SetResourceID(saved.ID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "group_conflict", err.Error())
		return
	}
	view, err := f.groupView(r, saved)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) deleteGroup(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedGroup(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.UserGroup.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("user_groups").SetResourceID(id)
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

func (f *Framework) groupMembers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedGroup(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	links, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(links))
	for _, link := range links {
		account, err := f.visibleUser(r.Context(), p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		view := f.memberView(r, account, link.CreatedAt)
		delete(view, "avatar")
		list = append(list, view)
	}
	respond(w, 200, list)
}

func (f *Framework) setGroupMembers(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	row, err := f.scopedGroup(r, p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if row.MemberMode != "static" {
		fail(w, 409, "dynamic_group", "动态用户组不能手工分配成员")
		return
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err := decode(r, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		fail(w, 400, "invalid_request", "成员列表无效")
		return
	}
	if err := f.validateGroupUsers(r, p, in.UserIDs); err != nil {
		fail(w, 400, "invalid_user", err.Error())
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		for _, userID := range in.UserIDs {
			if err := tx.UserGroupMember.Create().SetGroupID(id).SetUserID(userID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("set_members").SetResource("user_groups").SetResourceID(id)
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

func (f *Framework) groupRoles(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedGroup(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	links, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(links))
	for _, link := range links {
		row, err := f.Store.Client.Role.Get(r.Context(), link.RoleID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		if (row.TenantID == nil) != (p.TenantID == nil) || row.TenantID != nil && *row.TenantID != *p.TenantID {
			continue
		}
		list = append(list, map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "status": row.Status})
	}
	respond(w, 200, list)
}

func (f *Framework) setGroupRoles(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedGroup(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	var in struct {
		RoleIDs []int `json:"roleIds"`
	}
	if err := decode(r, &in); err != nil || in.RoleIDs == nil || len(in.RoleIDs) > 5000 {
		fail(w, 400, "invalid_request", "角色列表无效")
		return
	}
	if err := f.validateGroupRoles(r, p, in.RoleIDs); err != nil {
		fail(w, 400, "invalid_role", err.Error())
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if _, err := tx.UserGroupRole.Delete().Where(usergrouprole.GroupIDEQ(id)).Exec(r.Context()); err != nil {
			return err
		}
		for _, roleID := range in.RoleIDs {
			if err := tx.UserGroupRole.Create().SetGroupID(id).SetRoleID(roleID).Exec(r.Context()); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("set_roles").SetResource("user_groups").SetResourceID(id)
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
