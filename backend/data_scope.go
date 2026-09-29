package zenith

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userdepartmentscope"
)

// userDataPredicate follows Zenith's most permissive order: all, department
// descendants, custom departments, own department, then self. It is applied to
// lists, details, mutations and association selectors alike.
func (f *Framework) userDataPredicate(ctx context.Context, p *principal) (predicate.User, error) {
	if p.SuperAdmin {
		return nil, nil
	}
	scopes := map[string]bool{}
	custom := map[int]bool{}
	if p.User.UserDataScope != nil {
		scopes[*p.User.UserDataScope] = true
		if *p.User.UserDataScope == "custom" {
			links, err := f.Store.Client.UserDepartmentScope.Query().Where(userdepartmentscope.UserIDEQ(p.User.ID)).All(ctx)
			if err != nil {
				return nil, err
			}
			for _, link := range links {
				custom[link.DepartmentID] = true
			}
		}
	}
	ids, err := f.effectiveRoleIDs(ctx, p.User.ID)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if (row.TenantID == nil) != (p.User.TenantID == nil) || row.TenantID != nil && *row.TenantID != *p.User.TenantID {
			continue
		}
		scopes[row.DataScope] = true
		if row.DataScope == "custom" {
			links, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(id)).All(ctx)
			if err != nil {
				return nil, err
			}
			for _, link := range links {
				custom[link.DepartmentID] = true
			}
		}
	}
	if scopes["all"] {
		return nil, nil
	}
	if scopes["dept"] && p.User.DepartmentID != nil {
		rows, err := f.Store.Client.Department.Query().Where(departmentScope(p)).All(ctx)
		if err != nil {
			return nil, err
		}
		seen := map[int]bool{*p.User.DepartmentID: true}
		queue := []int{*p.User.DepartmentID}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			for _, row := range rows {
				if row.ParentID == current && !seen[row.ID] {
					seen[row.ID] = true
					queue = append(queue, row.ID)
				}
			}
		}
		ids := make([]int, 0, len(seen))
		for id := range seen {
			ids = append(ids, id)
		}
		return user.DepartmentIDIn(ids...), nil
	}
	if scopes["custom"] && len(custom) > 0 {
		ids := make([]int, 0, len(custom))
		for id := range custom {
			ids = append(ids, id)
		}
		return user.DepartmentIDIn(ids...), nil
	}
	if scopes["dept_only"] && p.User.DepartmentID != nil {
		return user.DepartmentIDEQ(*p.User.DepartmentID), nil
	}
	return user.IDEQ(p.User.ID), nil
}

func (f *Framework) visibleUser(ctx context.Context, p *principal, id int) (*ent.User, error) {
	scope, err := f.userDataPredicate(ctx, p)
	if err != nil {
		return nil, err
	}
	predicates := []predicate.User{user.IDEQ(id), userScope(p)}
	if scope != nil {
		predicates = append(predicates, scope)
	}
	return f.Store.Client.User.Query().Where(predicates...).Only(ctx)
}
