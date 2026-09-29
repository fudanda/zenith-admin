package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/usergroup"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/gorilla/mux"
)

var errInvalidGroupRule = errors.New("动态用户组规则无效")

type memberRule struct {
	DepartmentIDs         []int `json:"departmentIds,omitempty"`
	IncludeSubDepartments bool  `json:"includeSubDepartments,omitempty"`
	PositionIDs           []int `json:"positionIds,omitempty"`
	IncludeUserIDs        []int `json:"includeUserIds,omitempty"`
	ExcludeUserIDs        []int `json:"excludeUserIds,omitempty"`
}

func ruleFromMap(value map[string]any) (*memberRule, error) {
	if value == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var rule memberRule
	if err := json.Unmarshal(encoded, &rule); err != nil {
		return nil, err
	}
	return &rule, nil
}

func ruleToMap(rule *memberRule) (map[string]any, error) {
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

func validateRuleShape(rule *memberRule) error {
	if rule == nil {
		return errInvalidGroupRule
	}
	for _, item := range []struct {
		ids []int
		max int
	}{
		{rule.DepartmentIDs, 200}, {rule.PositionIDs, 200}, {rule.IncludeUserIDs, 500}, {rule.ExcludeUserIDs, 500},
	} {
		if len(item.ids) > item.max {
			return fmt.Errorf("%w: 条件过多", errInvalidGroupRule)
		}
		seen := map[int]bool{}
		for _, id := range item.ids {
			if id < 1 || seen[id] {
				return fmt.Errorf("%w: ID 无效或重复", errInvalidGroupRule)
			}
			seen[id] = true
		}
	}
	if len(rule.DepartmentIDs) == 0 && len(rule.PositionIDs) == 0 && len(rule.IncludeUserIDs) == 0 {
		return fmt.Errorf("%w: 至少需要部门、岗位或强制包含账号", errInvalidGroupRule)
	}
	return nil
}

func sameTenant(a, b *int) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func (f *Framework) validateRuleRefs(ctx context.Context, p *principal, rule *memberRule) error {
	if err := validateRuleShape(rule); err != nil {
		return err
	}
	for _, id := range rule.DepartmentIDs {
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), departmentScope(p)).Only(ctx); err != nil {
			if ent.IsNotFound(err) {
				return fmt.Errorf("%w: 部门不在当前租户", errInvalidGroupRule)
			}
			return err
		}
	}
	for _, id := range rule.PositionIDs {
		row, err := f.Store.Client.Position.Get(ctx, id)
		if ent.IsNotFound(err) || err == nil && !sameTenant(row.TenantID, p.TenantID) {
			return fmt.Errorf("%w: 岗位不在当前租户", errInvalidGroupRule)
		}
		if err != nil {
			return err
		}
	}
	for _, id := range append(append([]int{}, rule.IncludeUserIDs...), rule.ExcludeUserIDs...) {
		row, err := f.Store.Client.User.Get(ctx, id)
		if ent.IsNotFound(err) || err == nil && !sameTenant(row.TenantID, p.TenantID) {
			return fmt.Errorf("%w: 账号不在当前租户", errInvalidGroupRule)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

type ruleQueries struct {
	users       *ent.UserClient
	departments *ent.DepartmentClient
	positions   *ent.UserPositionClient
}

func targetRuleMembers(ctx context.Context, q ruleQueries, tenantID *int, rule *memberRule) (map[int]*ent.User, error) {
	if err := validateRuleShape(rule); err != nil {
		return nil, err
	}
	userQuery := q.users.Query().Where(user.StatusEQ("enabled"))
	if tenantID == nil {
		userQuery = userQuery.Where(user.TenantIDIsNil())
	} else {
		userQuery = userQuery.Where(user.TenantIDEQ(*tenantID))
	}
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
		if tenantID == nil {
			query = query.Where(department.TenantIDIsNil())
		} else {
			query = query.Where(department.TenantIDEQ(*tenantID))
		}
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

func syncRuleMembers(ctx context.Context, tx *ent.Tx, group *ent.UserGroup, rule *memberRule) (int, int, error) {
	// Updating the group row first serializes concurrent materializations for
	// this group before either transaction reads or diffs its members.
	if err := tx.UserGroup.UpdateOneID(group.ID).SetRuleSyncedAt(time.Now()).Exec(ctx); err != nil {
		return 0, 0, err
	}
	target, err := targetRuleMembers(ctx, ruleQueries{tx.User, tx.Department, tx.UserPosition}, group.TenantID, rule)
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

// Domain writes that affect rule membership call this inside their own
// transaction, so authorization inheritance changes with the user/org write.
func syncDynamicGroupsInTx(ctx context.Context, tx *ent.Tx, tenantID *int) error {
	query := tx.UserGroup.Query().Where(usergroup.MemberModeEQ("dynamic"))
	if tenantID == nil {
		query = query.Where(usergroup.TenantIDIsNil())
	} else {
		query = query.Where(usergroup.TenantIDEQ(*tenantID))
	}
	groups, err := query.All(ctx)
	if err != nil {
		return err
	}
	for _, group := range groups {
		rule, err := ruleFromMap(group.MemberRule)
		if err != nil {
			return err
		}
		if _, _, err := syncRuleMembers(ctx, tx, group, rule); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) reconcileDynamicGroups(ctx context.Context) error {
	groups, err := s.Client.UserGroup.Query().Where(usergroup.MemberModeEQ("dynamic")).All(ctx)
	if err != nil {
		return err
	}
	for _, group := range groups {
		if err := s.WithTx(ctx, func(tx *ent.Tx) error {
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

func (f *Framework) previewGroupRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GroupID    *int       `json:"groupId"`
		MemberRule memberRule `json:"memberRule"`
	}
	if err := decode(r, &body); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	p := fromContext(r.Context())
	if err := f.validateRuleRefs(r.Context(), p, &body.MemberRule); err != nil {
		if errors.Is(err, errInvalidGroupRule) {
			fail(w, 400, "invalid_rule", err.Error())
		} else {
			fail(w, 503, "database_unavailable", "规则校验失败")
		}
		return
	}
	current := map[int]bool{}
	if body.GroupID != nil {
		group, err := f.scopedGroup(r, p, *body.GroupID)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "用户组不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		links, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.GroupIDEQ(group.ID)).All(r.Context())
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		for _, link := range links {
			current[link.UserID] = true
		}
	}
	target, err := targetRuleMembers(r.Context(), ruleQueries{f.Store.Client.User, f.Store.Client.Department, f.Store.Client.UserPosition}, p.TenantID, &body.MemberRule)
	if err != nil {
		fail(w, 503, "database_unavailable", "预览失败")
		return
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
			row, err := f.Store.Client.User.Get(r.Context(), id)
			if err != nil {
				return nil, err
			}
			list = append(list, map[string]any{"id": row.ID, "username": row.Username, "nickname": row.Nickname})
		}
		return list, nil
	}
	joiningView, err := preview(joining)
	if err != nil {
		fail(w, 503, "database_unavailable", "预览失败")
		return
	}
	leavingView, err := preview(leaving)
	if err != nil {
		fail(w, 503, "database_unavailable", "预览失败")
		return
	}
	respond(w, 200, map[string]any{"total": len(target), "joiningCount": len(joining), "leavingCount": len(leaving), "joining": joiningView, "leaving": leavingView})
}

func (f *Framework) syncGroup(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	var added, removed int
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		group, err := tx.UserGroup.Query().Where(usergroup.IDEQ(id), groupScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		if group.MemberMode != "dynamic" {
			return fmt.Errorf("%w: 手工组不能同步", errInvalidGroupRule)
		}
		rule, err := ruleFromMap(group.MemberRule)
		if err != nil {
			return err
		}
		added, removed, err = syncRuleMembers(r.Context(), tx, group, rule)
		if err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("sync").SetResource("user_groups").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "用户组不存在")
		return
	}
	if errors.Is(err, errInvalidGroupRule) {
		fail(w, 409, "invalid_group_mode", err.Error())
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "同步失败")
		return
	}
	respond(w, 200, map[string]int{"added": added, "removed": removed})
}
