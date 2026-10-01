package usergroups

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/usergroup"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

type Dependencies struct {
	VisibleUser        func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error)
	ValidateGrantRoles func(ctx context.Context, p *kernel.Principal, ids []int) error
	WriteMemberPreview func(ctx context.Context, inArgs kernel.Input, query *ent.UserQuery) (kernel.Outcome, error)

	MemberSummary      func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (int, []map[string]any, error)
	VisibleMemberQuery func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (*ent.UserQuery, error)
	MemberView         func(ctx context.Context, inArgs kernel.Input, account *ent.User, joinedAt time.Time) map[string]any
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

func ruleFromMap(value map[string]any) (*kernel.MemberRule, error) {
	if value == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var rule kernel.MemberRule
	if err := json.Unmarshal(encoded, &rule); err != nil {
		return nil, err
	}
	return &rule, nil
}

func ruleToMap(rule *kernel.MemberRule) (map[string]any, error) {
	if rule == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(rule)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func validateRuleShape(rule *kernel.MemberRule) error {
	if rule == nil {
		return kernel.ErrInvalidGroupRule
	}
	for _, item := range []struct {
		ids []int
		max int
	}{
		{rule.DepartmentIDs, 200}, {rule.PositionIDs, 200}, {rule.IncludeUserIDs, 500}, {rule.ExcludeUserIDs, 500},
	} {
		if len(item.ids) > item.max {
			return fmt.Errorf("%w: 条件过多", kernel.ErrInvalidGroupRule)
		}
		seen := map[int]bool{}
		for _, id := range item.ids {
			if id < 1 || seen[id] {
				return fmt.Errorf("%w: ID 无效或重复", kernel.ErrInvalidGroupRule)
			}
			seen[id] = true
		}
	}
	if len(rule.DepartmentIDs) == 0 && len(rule.PositionIDs) == 0 && len(rule.IncludeUserIDs) == 0 {
		return fmt.Errorf("%w: 至少需要部门、岗位或强制包含账号", kernel.ErrInvalidGroupRule)
	}
	return nil
}

type ruleQueries struct {
	users       *ent.UserClient
	departments *ent.DepartmentClient
	positions   *ent.UserPositionClient
}

func targetRuleMembers(ctx context.Context, q ruleQueries, rule *kernel.MemberRule) (map[int]*ent.User, error) {
	if err := validateRuleShape(rule); err != nil {
		return nil, err
	}
	userQuery := q.users.Query().Where(user.StatusEQ("enabled"))

	users, err := userQuery.All(ctx)
	if err != nil {
		return nil, err
	}
	departmentSet := map[int]bool{}
	for _, id := range rule.DepartmentIDs {
		departmentSet[id] = true
	}
	if rule.IncludeSubDepartments && len(departmentSet) > 0 {
		query := q.departments.Query()

		rows, err := query.All(ctx)
		if err != nil {
			return nil, err
		}
		for changed := true; changed; {
			changed = false
			for _, row := range rows {
				if departmentSet[row.ParentID] && !departmentSet[row.ID] {
					departmentSet[row.ID] = true
					changed = true
				}
			}
		}
	}
	positionSet := map[int]bool{}
	for _, id := range rule.PositionIDs {
		positionSet[id] = true
	}
	positionUsers := map[int]bool{}
	if len(positionSet) > 0 {
		links, err := q.positions.Query().Where(userposition.PositionIDIn(rule.PositionIDs...)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, link := range links {
			positionUsers[link.UserID] = true
		}
	}
	include := map[int]bool{}
	exclude := map[int]bool{}
	for _, id := range rule.IncludeUserIDs {
		include[id] = true
	}
	for _, id := range rule.ExcludeUserIDs {
		exclude[id] = true
	}
	target := map[int]*ent.User{}
	for _, row := range users {
		matched := len(departmentSet) > 0 || len(positionSet) > 0
		if len(departmentSet) > 0 {
			matched = matched && row.DepartmentID != nil && departmentSet[*row.DepartmentID]
		}
		if len(positionSet) > 0 {
			matched = matched && positionUsers[row.ID]
		}
		if (matched || include[row.ID]) && !exclude[row.ID] {
			target[row.ID] = row
		}
	}
	return target, nil
}

func syncRuleMembers(ctx context.Context, tx *ent.Tx, group *ent.UserGroup, rule *kernel.MemberRule, validateNewGrants ...func() error) (int, int, error) {
	// Updating the group row first serializes concurrent materializations for
	// this group before either transaction reads or diffs its members.
	if err := tx.UserGroup.UpdateOneID(group.ID).SetRuleSyncedAt(time.Now()).Exec(ctx); err != nil {
		return 0, 0, err
	}
	target, err := targetRuleMembers(ctx, ruleQueries{tx.User, tx.Department, tx.UserPosition}, rule)
	if err != nil {
		return 0, 0, err
	}
	current, err := tx.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(group.ID)).All(ctx)
	if err != nil {
		return 0, 0, err
	}
	toRemove := make([]int, 0)
	for _, link := range current {
		if _, present := target[link.UserID]; present {
			delete(target, link.UserID)
		} else {
			toRemove = append(toRemove, link.UserID)
		}
	}
	if len(target) > 0 {
		for _, validate := range validateNewGrants {
			if err := validate(); err != nil {
				return 0, 0, err
			}
		}
	}
	if len(toRemove) > 0 {
		if _, err := tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(group.ID), usergroupmember.UserIDIn(toRemove...)).Exec(ctx); err != nil {
			return 0, 0, err
		}
	}
	for id := range target {
		if err := tx.UserGroupMember.Create().SetGroupID(group.ID).SetUserID(id).Exec(ctx); err != nil {
			return 0, 0, err
		}
	}
	return len(target), len(toRemove), nil
}

var groupCodePattern = regexp.MustCompile(`^\w+$`)

func groupScope(_ *kernel.Principal) predicate.UserGroup { return usergroup.IDGT(0) }

type groupInput struct {
	Name, Code, Status, MemberMode string
	Description                    *string
	OwnerID                        *int
	MemberRule                     *kernel.MemberRule
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
	if in.MemberMode != "static" && in.MemberMode != "dynamic" {
		return errors.New("成员模式无效")
	}
	if in.MemberMode == "dynamic" {
		if err := validateRuleShape(in.MemberRule); err != nil {
			return err
		}
	}
	if in.Description != nil && len([]rune(*in.Description)) > 256 {
		return errors.New("说明过长")
	}
	return nil
}

func (f *Service) ValidateRuleRefs(ctx context.Context, p *kernel.Principal, rule *kernel.MemberRule) error {
	if err := validateRuleShape(rule); err != nil {
		return err
	}
	for _, id := range rule.DepartmentIDs {
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), kernel.DepartmentScope(p)).Only(ctx); err != nil {
			if ent.IsNotFound(err) {
				return fmt.Errorf("%w: 部门不在当前组织", kernel.ErrInvalidGroupRule)
			}
			return err
		}
	}
	for _, id := range rule.PositionIDs {
		_, err := f.Store.Client.Position.Get(ctx, id)
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: 岗位不在当前组织", kernel.ErrInvalidGroupRule)
		}
		if err != nil {
			return err
		}
	}
	for _, id := range append(append([]int{}, rule.IncludeUserIDs...), rule.ExcludeUserIDs...) {
		_, err := f.deps.VisibleUser(ctx, p, id)
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: 账号不在当前组织", kernel.ErrInvalidGroupRule)
		}
		if err != nil {
			return err
		}
	}
	target, err := targetRuleMembers(ctx, ruleQueries{f.Store.Client.User, f.Store.Client.Department, f.Store.Client.UserPosition}, rule)
	if err != nil {
		return err
	}
	for id := range target {
		if _, err := f.deps.VisibleUser(ctx, p, id); err != nil {
			return fmt.Errorf("%w: 规则覆盖了超出管理范围的账号", kernel.ErrInvalidGroupRule)
		}
	}
	return nil
}

func (f *Service) SyncDynamicGroupsInTx(ctx context.Context, tx *ent.Tx, actor *kernel.Principal) error {
	query := tx.UserGroup.Query().Where(usergroup.MemberModeEQ("dynamic"))

	groups, err := query.All(ctx)
	if err != nil {
		return err
	}
	for _, group := range groups {
		rule, err := ruleFromMap(group.MemberRule)
		if err != nil {
			return err
		}
		if _, _, err := f.SyncRuleMembersAs(ctx, tx, actor, group, rule); err != nil {
			return err
		}
	}
	return nil
}

func (f *Service) SyncRuleMembersAs(ctx context.Context, tx *ent.Tx, actor *kernel.Principal, group *ent.UserGroup, rule *kernel.MemberRule) (int, int, error) {
	return syncRuleMembers(ctx, tx, group, rule, func() error {
		if actor == nil || actor.SuperAdmin || group.Status != "enabled" {
			return nil
		}
		ids, err := tx.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).Select(usergrouprole.FieldRoleID).Ints(ctx)
		if err != nil {
			return err
		}
		enabled, err := tx.Role.Query().Where(role.IDIn(ids...), role.StatusEQ("enabled")).IDs(ctx)
		if err != nil {
			return err
		}
		return f.deps.ValidateGrantRoles(ctx, actor, enabled)
	})
}

func (f *Service) ReconcileDynamicGroups(ctx context.Context) error {
	groups, err := f.Store.Client.UserGroup.Query().Where(usergroup.MemberModeEQ("dynamic")).All(ctx)
	if err != nil {
		return err
	}
	for _, group := range groups {
		if err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
			fresh, err := tx.UserGroup.Get(ctx, group.ID)
			if ent.IsNotFound(err) {
				return nil
			}
			if err != nil {
				return err
			}
			if fresh.MemberMode != "dynamic" {
				return nil
			}
			rule, err := ruleFromMap(fresh.MemberRule)
			if err != nil {
				return err
			}
			_, _, err = syncRuleMembers(ctx, tx, fresh, rule)
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}

func (f *Service) PreviewGroupRule(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var body struct {
		GroupID    *int              `json:"groupId"`
		MemberRule kernel.MemberRule `json:"memberRule"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &body); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	p := kernel.FromContext(ctx)
	if err := f.ValidateRuleRefs(ctx, p, &body.MemberRule); err != nil {
		if errors.Is(err, kernel.ErrInvalidGroupRule) {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_rule", err.Error())
		} else {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "规则校验失败")
		}

	}
	current := map[int]bool{}
	if body.GroupID != nil {
		group, err := f.ScopedGroup(ctx, inArgs, p, *body.GroupID)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		links, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(group.ID)).All(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		for _, link := range links {
			if _, err := f.deps.VisibleUser(ctx, p, link.UserID); err == nil {
				current[link.UserID] = true
			} else if !ent.IsNotFound(err) {
				return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
			}
		}
	}
	target, err := targetRuleMembers(ctx, ruleQueries{f.Store.Client.User, f.Store.Client.Department, f.Store.Client.UserPosition}, &body.MemberRule)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "预览失败")
	}
	joining, leaving := make([]int, 0), make([]int, 0)
	for id := range target {
		if !current[id] {
			joining = append(joining, id)
		}
	}
	for id := range current {
		if target[id] == nil {
			leaving = append(leaving, id)
		}
	}
	sort.Ints(joining)
	sort.Ints(leaving)
	preview := func(ids []int) ([]any, error) {
		list := make([]any, 0)
		for _, id := range ids {
			if len(list) == 50 {
				break
			}
			row, err := f.Store.Client.User.Get(ctx, id)
			if err != nil {
				return nil, err
			}
			list = append(list, map[string]any{"id": row.ID, "username": row.Username, "nickname": row.Nickname})
		}
		return list, nil
	}
	joiningView, err := preview(joining)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "预览失败")
	}
	leavingView, err := preview(leaving)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "预览失败")
	}
	return kernel.Success(200, map[string]any{"total": len(target), "joiningCount": len(joining), "leavingCount": len(leaving), "joining": joiningView, "leaving": leavingView})
}

func (f *Service) SyncGroup(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if err := f.ValidateExistingGroupGrant(ctx, inArgs, p, id); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	group, err := f.ScopedGroup(ctx, inArgs, p, id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	rule, err := ruleFromMap(group.MemberRule)
	if err != nil || f.ValidateRuleRefs(ctx, p, rule) != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", "规则覆盖了管理范围外的账号")
	}
	links, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	for _, link := range links {
		if _, err := f.deps.VisibleUser(ctx, p, link.UserID); err != nil {
			return kernel.Outcome{}, kernel.Fail(403, "grant_denied", "用户组包含管理范围外的账号")
		}
	}
	var added, removed int
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		group, err := tx.UserGroup.Query().Where(usergroup.IDEQ(id), groupScope(p)).Only(ctx)
		if err != nil {
			return err
		}
		if group.MemberMode != "dynamic" {
			return fmt.Errorf("%w: 手工组不能同步", kernel.ErrInvalidGroupRule)
		}
		rule, err := ruleFromMap(group.MemberRule)
		if err != nil {
			return err
		}
		added, removed, err = f.SyncRuleMembersAs(ctx, tx, p, group, rule)
		if err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("sync").SetResource("user_groups").SetResourceID(id)

		return log.Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if errors.Is(err, kernel.ErrInvalidGroupRule) {
		return kernel.Outcome{}, kernel.Fail(409, "invalid_group_mode", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "同步失败")
	}
	return kernel.Success(200, map[string]int{"added": added, "removed": removed})
}

func (f *Service) GroupMemberPreview(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.ScopedGroup(ctx, inArgs, kernel.FromContext(ctx), id); err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	ids, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id)).Select(usergroupmember.FieldUserID).Ints(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	return f.deps.WriteMemberPreview(ctx, inArgs, f.Store.Client.User.Query().Where(user.IDIn(ids...)))
}

func (f *Service) ChangeGroupMembers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	row, err := f.ScopedGroup(ctx, inArgs, p, id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if row.MemberMode != "static" {
		return kernel.Outcome{}, kernel.Fail(409, "dynamic_group", "动态组不能手工修改成员")
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err = kernel.DecodeBody(inArgs.Body, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "成员列表无效")
	}
	if err = f.ValidateGroupUsers(ctx, inArgs, p, in.UserIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	roles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(id)).Select(usergrouprole.FieldRoleID).Ints(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权查询失败")
	}
	if err = f.deps.ValidateGrantRoles(ctx, p, roles); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if inArgs.Remove {
			if _, err := tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(id), usergroupmember.UserIDIn(in.UserIDs...)).Exec(ctx); err != nil {
				return err
			}
		} else {
			for _, uid := range in.UserIDs {
				exists, err := tx.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id), usergroupmember.UserIDEQ(uid)).Exist(ctx)
				if err != nil {
					return err
				}
				if !exists {
					if err = tx.UserGroupMember.Create().SetGroupID(id).SetUserID(uid).Exec(ctx); err != nil {
						return err
					}
				}
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetResource("user_groups").SetResourceID(id).SetOperation("change_members").Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员保存失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) DeleteGroupsBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		IDs []int `json:"ids"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || !kernel.ValidBatchUserIDs(in.IDs) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "用户组列表无效")
	}
	p := kernel.FromContext(ctx)
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		count, err := tx.UserGroup.Delete().Where(usergroup.IDIn(in.IDs...)).Exec(ctx)
		if err != nil {
			return err
		}
		if count != len(in.IDs) {
			return errors.New("部分用户组不存在")
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetResource("user_groups").SetOperation("delete_batch").Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "delete_failed", "部分用户组不存在或删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) ScopedGroup(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int) (*ent.UserGroup, error) {
	return f.Store.Client.UserGroup.Query().Where(usergroup.IDEQ(id), groupScope(p)).Only(ctx)
}

func (f *Service) GroupView(ctx context.Context, inArgs kernel.Input, row *ent.UserGroup) (map[string]any, error) {
	members, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(row.ID)).All(ctx)
	if err != nil {
		return nil, err
	}
	roles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(row.ID)).All(ctx)
	if err != nil {
		return nil, err
	}
	var ownerName *string
	if row.OwnerID != nil {
		owner, err := f.deps.VisibleUser(ctx, kernel.FromContext(ctx), *row.OwnerID)
		if err == nil {
			ownerName = &owner.Nickname
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	memberIDs := make([]int, 0, len(members))
	for _, link := range members {
		memberIDs = append(memberIDs, link.UserID)
	}
	count, preview, err := f.deps.MemberSummary(ctx, kernel.FromContext(ctx), f.Store.Client.User.Query().Where(user.IDIn(memberIDs...)))
	if err != nil {
		return nil, err
	}
	rolePreview := make([]map[string]any, 0, len(roles))
	for _, link := range roles {
		role, err := f.Store.Client.Role.Get(ctx, link.RoleID)
		if err != nil {
			return nil, err
		}
		rolePreview = append(rolePreview, map[string]any{"id": role.ID, "name": role.Name, "code": role.Code, "status": role.Status})
	}
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "ownerId": row.OwnerID, "ownerName": ownerName,
		"memberMode": row.MemberMode, "memberRule": row.MemberRule, "ruleSyncedAt": row.RuleSyncedAt, "memberCount": count, "memberPreview": preview, "rolePreview": rolePreview, "roleCount": len(roles), "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Service) ListGroups(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	q := inArgs.Filter
	page, err := kernel.PositiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	size, err := kernel.PositiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page_size", err.Error())
	}
	query := f.Store.Client.UserGroup.Query().Where(groupScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(usergroup.Or(usergroup.NameContainsFold(keyword), usergroup.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_status", "状态无效")
		}
		query = query.Where(usergroup.StatusEQ(status))
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Desc(usergroup.FieldID)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.GroupView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) AllGroups(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.Store.Client.UserGroup.Query().Where(groupScope(kernel.FromContext(ctx)), usergroup.StatusEQ("enabled")).Order(ent.Asc(usergroup.FieldName)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.GroupView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, list)
}

func (f *Service) GetGroup(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.ScopedGroup(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.GroupView(ctx, inArgs, row)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) ValidateGroupRoles(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, ids []int) error {
	return f.deps.ValidateGrantRoles(ctx, p, ids)
}

func (f *Service) ValidateGroupUsers(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, ids []int) error {
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return errors.New("用户 ID 无效或重复")
		}
		seen[id] = true
		if _, err := f.deps.VisibleUser(ctx, p, id); err != nil {
			return errors.New("用户不在可管理范围")
		}
	}
	return nil
}

func (f *Service) ValidateExistingGroupGrant(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int) error {
	ids, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(id)).Select(usergrouprole.FieldRoleID).Ints(ctx)
	if err != nil {
		return err
	}
	return f.deps.ValidateGrantRoles(ctx, p, ids)
}

func (f *Service) SaveGroup(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	p := kernel.FromContext(ctx)
	in := groupInput{Status: "enabled", MemberMode: "static", RoleIDs: []int{}, UserIDs: []int{}}
	if id != 0 {
		current, err := f.ScopedGroup(ctx, inArgs, p, id)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		rule, err := ruleFromMap(current.MemberRule)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "规则读取失败")
		}
		in = groupInput{Name: current.Name, Code: current.Code, Description: current.Description, OwnerID: current.OwnerID, Status: current.Status, MemberMode: current.MemberMode, MemberRule: rule}
	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "用户组内容无效")
	}
	rolesChanged := false
	usersChanged := false
	ruleChanged := false
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
			ruleChanged = true
			err = json.Unmarshal(raw, &in.MemberMode)
		case "memberRule":
			ruleChanged = true
			if string(raw) == "null" {
				in.MemberRule = nil
			} else {
				decoder := json.NewDecoder(bytes.NewReader(raw))
				decoder.DisallowUnknownFields()
				var parsed kernel.MemberRule
				err = decoder.Decode(&parsed)
				if err == nil {
					var extra any
					if nextErr := decoder.Decode(&extra); !errors.Is(nextErr, io.EOF) {
						err = errors.New("规则 JSON 包含多余内容")
					}
				}
				if err == nil {
					in.MemberRule = &parsed
				}
			}
		case "roleIds":
			rolesChanged = true
			err = json.Unmarshal(raw, &in.RoleIDs)
		case "userIds":
			usersChanged = true
			err = json.Unmarshal(raw, &in.UserIDs)
		default:
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if err := validateGroup(in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	if in.MemberMode == "dynamic" {
		if usersChanged && len(in.UserIDs) > 0 {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "动态组不能手工分配成员")
		}
		if err := f.ValidateRuleRefs(ctx, p, in.MemberRule); err != nil {
			if errors.Is(err, kernel.ErrInvalidGroupRule) {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_rule", err.Error())
			} else {
				return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "规则校验失败")
			}

		}
	} else {
		in.MemberRule = nil
	}
	if in.OwnerID != nil {
		if _, err := f.deps.VisibleUser(ctx, p, *in.OwnerID); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_owner", "负责人不在可管理范围")
		}
	}
	if rolesChanged || id == 0 {
		if err := f.ValidateGroupRoles(ctx, inArgs, p, in.RoleIDs); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_role", err.Error())
		}
	}
	if usersChanged || id == 0 {
		if err := f.ValidateGroupUsers(ctx, inArgs, p, in.UserIDs); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_user", err.Error())
		}
	}
	if id != 0 && !rolesChanged && (usersChanged || ruleChanged || in.Status == "enabled") {
		if err := f.ValidateExistingGroupGrant(ctx, inArgs, p, id); err != nil {
			return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
		}
	}
	visible, err := f.deps.VisibleMemberQuery(ctx, p, f.Store.Client.User.Query())
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	visibleIDs, err := visible.IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	var saved *ent.UserGroup
	ruleData, err := ruleToMap(in.MemberRule)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_rule", "规则格式无效")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.UserGroup.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetMemberMode(in.MemberMode)
			if ruleData != nil {
				create.SetMemberRule(ruleData)
			}

			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			if in.OwnerID != nil {
				create.SetOwnerID(*in.OwnerID)
			}
			saved, err = create.Save(ctx)
		} else {
			update := tx.UserGroup.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetMemberMode(in.MemberMode)
			if ruleData != nil {
				update.SetMemberRule(ruleData)
			} else {
				update.ClearMemberRule()
				update.ClearRuleSyncedAt()
			}
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
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		if rolesChanged || id == 0 {
			if _, err = tx.UserGroupRole.Delete().Where(usergrouprole.GroupIDEQ(saved.ID)).Exec(ctx); err != nil {
				return err
			}
			for _, roleID := range in.RoleIDs {
				if err = tx.UserGroupRole.Create().SetGroupID(saved.ID).SetRoleID(roleID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if in.MemberMode == "static" && (usersChanged || id == 0) {
			if _, err = tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(saved.ID), usergroupmember.UserIDIn(visibleIDs...)).Exec(ctx); err != nil {
				return err
			}
			for _, userID := range in.UserIDs {
				if err = tx.UserGroupMember.Create().SetGroupID(saved.ID).SetUserID(userID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if in.MemberMode == "dynamic" && (ruleChanged || id == 0) {
			if _, _, err = f.SyncRuleMembersAs(ctx, tx, p, saved, in.MemberRule); err != nil {
				return err
			}
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("user_groups").SetResourceID(saved.ID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "group_conflict", err.Error())
	}
	saved, err = f.Store.Client.UserGroup.Get(ctx, saved.ID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.GroupView(ctx, inArgs, saved)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) DeleteGroup(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedGroup(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.UserGroup.DeleteOneID(id).Exec(ctx); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("user_groups").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) GroupMembers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedGroup(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	links, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(id)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(links))
	for _, link := range links {
		account, err := f.deps.VisibleUser(ctx, p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		view := f.deps.MemberView(ctx, inArgs, account, link.CreatedAt)
		delete(view, "avatar")
		list = append(list, view)
	}
	return kernel.Success(200, list)
}

func (f *Service) SetGroupMembers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	row, err := f.ScopedGroup(ctx, inArgs, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if row.MemberMode != "static" {
		return kernel.Outcome{}, kernel.Fail(409, "dynamic_group", "动态用户组不能手工分配成员")
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "成员列表无效")
	}
	if err := f.ValidateGroupUsers(ctx, inArgs, p, in.UserIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_user", err.Error())
	}
	if err := f.ValidateExistingGroupGrant(ctx, inArgs, p, id); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	visible, err := f.deps.VisibleMemberQuery(ctx, p, f.Store.Client.User.Query())
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	visibleIDs, err := visible.IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.UserGroupMember.Delete().Where(usergroupmember.GroupIDEQ(id), usergroupmember.UserIDIn(visibleIDs...)).Exec(ctx); err != nil {
			return err
		}
		for _, userID := range in.UserIDs {
			if err := tx.UserGroupMember.Create().SetGroupID(id).SetUserID(userID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("set_members").SetResource("user_groups").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) GroupRoles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedGroup(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	links, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(id)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(links))
	for _, link := range links {
		row, err := f.Store.Client.Role.Get(ctx, link.RoleID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}

		list = append(list, map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "status": row.Status})
	}
	return kernel.Success(200, list)
}

func (f *Service) SetGroupRoles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedGroup(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "用户组不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	var in struct {
		RoleIDs []int `json:"roleIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.RoleIDs == nil || len(in.RoleIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "角色列表无效")
	}
	if err := f.ValidateGroupRoles(ctx, inArgs, p, in.RoleIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_role", err.Error())
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.UserGroupRole.Delete().Where(usergrouprole.GroupIDEQ(id)).Exec(ctx); err != nil {
			return err
		}
		for _, roleID := range in.RoleIDs {
			if err := tx.UserGroupRole.Create().SetGroupID(id).SetRoleID(roleID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("set_roles").SetResource("user_groups").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	return kernel.Success(200, nil)
}
