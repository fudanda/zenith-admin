package zenith

import (
	"context"
	"errors"

	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/user"
)

var errGrantDenied = errors.New("不能授予超出本人权限或数据范围的授权")

func (f *Framework) validateGrantMenus(ctx context.Context, p *principal, ids []int) error {
	allowed, err := f.permissions(ctx, p)
	if err != nil {
		return err
	}
	set := map[string]bool{}
	for _, permission := range allowed {
		set[permission] = true
	}
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return errors.New("菜单 ID 无效或重复")
		}
		seen[id] = true
		row, err := f.Store.Client.Menu.Query().Where(menu.IDEQ(id), menu.StatusEQ("enabled")).Only(ctx)
		if err != nil {
			return err
		}
		if !p.SuperAdmin && row.Permission != nil && *row.Permission != "" && !set[*row.Permission] {
			return errGrantDenied
		}
	}
	return nil
}

// Fixed department scopes can be delegated by a restricted administrator.
// Relative scopes on reusable roles require an administrator with all-data
// access, because they may later be assigned in a different department.
func (f *Framework) validateGrantScope(ctx context.Context, p *principal, scope string, departments []int) error {
	if p.SuperAdmin {
		return nil
	}
	actor, err := f.userDataPredicate(ctx, p)
	if err != nil {
		return err
	}
	if actor == nil {
		return nil
	}
	if scope == "self" {
		return nil
	}
	if scope != "custom" {
		return errGrantDenied
	}
	for _, id := range departments {
		outside, err := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id), user.Not(actor)).Exist(ctx)
		if err != nil {
			return err
		}
		if outside {
			return errGrantDenied
		}
		// Require the department itself to be represented in the actor's range;
		// an empty department must never become a way to grant future access.
		inside, err := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id), actor).Exist(ctx)
		if err != nil {
			return err
		}
		if !inside {
			return errGrantDenied
		}
	}
	return nil
}

func (f *Framework) validateGrantRoles(ctx context.Context, p *principal, ids []int) error {
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return errors.New("角色 ID 无效或重复")
		}
		seen[id] = true
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
		if err != nil {
			return err
		}
		if row.Code == "super_admin" {
			return errors.New("系统超级管理员角色只能通过初始化命令分配")
		}
		menus, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(id)).Select(rolemenu.FieldMenuID).Ints(ctx)
		if err != nil {
			return err
		}
		if err = f.validateGrantMenus(ctx, p, menus); err != nil {
			return err
		}
		departments, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(id)).Select(roledepartment.FieldDepartmentID).Ints(ctx)
		if err != nil {
			return err
		}
		if err = f.validateGrantScope(ctx, p, row.DataScope, departments); err != nil {
			return err
		}
	}
	return nil
}
