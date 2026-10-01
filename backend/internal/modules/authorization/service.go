package authorization

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/roledepartment"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userdepartmentscope"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/validation"
)

type Dependencies struct {
	ScopedUser func(context.Context, kernel.Input, *kernel.Principal, int) (*ent.User, error)

	ProtectedBatchUser func(ctx context.Context, inArgs kernel.Input, id int) (bool, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

func sortedIDs(set map[int]bool) []int {
	ids := make([]int, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func sortedMapKeys(values map[int]map[string]any) []int {
	keys := make([]int, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Ints(keys)
	return keys
}

var errInvalidMenu = errors.New("菜单数据无效")

var errMenuReferenced = errors.New("菜单仍被角色或用户引用")

type menuInput struct {
	ParentID   int     `json:"parentId"`
	Title      string  `json:"title"`
	Name       *string `json:"name"`
	Path       *string `json:"path"`
	Component  *string `json:"component"`
	Icon       *string `json:"icon"`
	Type       string  `json:"type"`
	Permission *string `json:"permission"`
	Query      *string `json:"query"`
	IsExternal bool    `json:"isExternal"`
	Embed      bool    `json:"embed"`
	KeepAlive  bool    `json:"keepAlive"`
	Sort       int     `json:"sort"`
	Status     string  `json:"status"`
	Visible    bool    `json:"visible"`
}

func menuInputFrom(row *ent.Menu) menuInput {
	return menuInput{ParentID: row.ParentID, Title: row.Title, Name: row.Name, Path: row.Path,
		Component: row.Component, Icon: row.Icon, Type: row.Type, Permission: row.Permission,
		Query: row.Query, IsExternal: row.IsExternal, Embed: row.Embed, KeepAlive: row.KeepAlive,
		Sort: row.Sort, Status: row.Status, Visible: row.Visible}
}

func mergeMenuInput(initial menuInput, patch map[string]json.RawMessage) (menuInput, error) {
	encoded, err := json.Marshal(patch)
	if err != nil {
		return initial, err
	}
	if err := json.Unmarshal(encoded, &initial); err != nil {
		return initial, fmt.Errorf("%w: %v", errInvalidMenu, err)
	}
	return initial, nil
}

func validateMenu(in menuInput) error {
	if in.ParentID < 0 || utf8.RuneCountInString(strings.TrimSpace(in.Title)) == 0 || utf8.RuneCountInString(in.Title) > 64 {
		return fmt.Errorf("%w: 标题或父级无效", errInvalidMenu)
	}
	if in.Type != "directory" && in.Type != "menu" && in.Type != "button" {
		return fmt.Errorf("%w: 类型无效", errInvalidMenu)
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return fmt.Errorf("%w: 状态无效", errInvalidMenu)
	}
	for _, field := range []struct {
		value *string
		max   int
	}{{in.Name, 64}, {in.Path, 256}, {in.Component, 256}, {in.Icon, 64}, {in.Permission, 128}, {in.Query, 512}} {
		if field.value != nil && utf8.RuneCountInString(*field.value) > field.max {
			return fmt.Errorf("%w: 字段过长", errInvalidMenu)
		}
	}
	if in.Permission != nil && *in.Permission != "" {
		known := false
		for _, item := range kernel.FoundationMenus {
			if item.Permission == *in.Permission {
				known = true
				break
			}
		}
		if !known {
			return fmt.Errorf("%w: 权限码未在首版操作清单中", errInvalidMenu)
		}
	}
	if in.Type == "button" && (in.Permission == nil || *in.Permission == "") {
		return fmt.Errorf("%w: 按钮需要权限码", errInvalidMenu)
	}
	if in.Type == "menu" && in.Path != nil && *in.Path != "" {
		registered := false
		for _, item := range kernel.FoundationMenus {
			if item.Type == "menu" && item.Path == *in.Path {
				registered = true
				break
			}
		}
		if !registered {
			return fmt.Errorf("%w: 页面尚未进入首版构建", errInvalidMenu)
		}
	}
	return nil
}

func validateMenuParent(ctx context.Context, tx *ent.Tx, id, parentID int) error {
	seen := map[int]bool{id: true}
	for parentID != 0 {
		if seen[parentID] {
			return fmt.Errorf("%w: 不能移动到自身或后代", errInvalidMenu)
		}
		seen[parentID] = true
		parent, err := tx.Menu.Get(ctx, parentID)
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: 父菜单不存在", errInvalidMenu)
		}
		if err != nil {
			return err
		}
		if parent.Type == "button" {
			return fmt.Errorf("%w: 按钮不能作为父级", errInvalidMenu)
		}
		parentID = parent.ParentID
	}
	return nil
}

func applyMenuCreate(create *ent.MenuCreate, in menuInput) *ent.MenuCreate {
	create.SetParentID(in.ParentID).SetTitle(strings.TrimSpace(in.Title)).SetType(in.Type).SetSort(in.Sort).
		SetStatus(in.Status).SetVisible(in.Visible).SetIsExternal(in.IsExternal).SetEmbed(in.Embed).SetKeepAlive(in.KeepAlive)
	create.SetNillableName(in.Name).SetNillablePath(in.Path).SetNillableComponent(in.Component).
		SetNillableIcon(in.Icon).SetNillablePermission(in.Permission).SetNillableQuery(in.Query)
	return create
}

func applyMenuUpdate(update *ent.MenuUpdateOne, in menuInput) *ent.MenuUpdateOne {
	update.SetParentID(in.ParentID).SetTitle(strings.TrimSpace(in.Title)).SetType(in.Type).SetSort(in.Sort).
		SetStatus(in.Status).SetVisible(in.Visible).SetIsExternal(in.IsExternal).SetEmbed(in.Embed).SetKeepAlive(in.KeepAlive)
	if in.Name == nil {
		update.ClearName()
	} else {
		update.SetName(*in.Name)
	}
	if in.Path == nil {
		update.ClearPath()
	} else {
		update.SetPath(*in.Path)
	}
	if in.Component == nil {
		update.ClearComponent()
	} else {
		update.SetComponent(*in.Component)
	}
	if in.Icon == nil {
		update.ClearIcon()
	} else {
		update.SetIcon(*in.Icon)
	}
	if in.Permission == nil {
		update.ClearPermission()
	} else {
		update.SetPermission(*in.Permission)
	}
	if in.Query == nil {
		update.ClearQuery()
	} else {
		update.SetQuery(*in.Query)
	}
	return update
}

func auditMenu(ctx context.Context, tx *ent.Tx, actorID int, trace, action string, id int) error {
	return tx.AuditLog.Create().SetActorID(actorID).SetRequestID(trace).SetOperation(action).
		SetResource("menus").SetResourceID(id).Exec(ctx)
}

func validateRole(in kernel.RoleInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("角色名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !kernel.RoleCodePattern.MatchString(in.Code) {
		return errors.New("角色编码无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if !kernel.DataScopes[in.DataScope] {
		return errors.New("数据范围无效")
	}
	if in.Description != nil && len([]rune(*in.Description)) > 256 {
		return errors.New("说明过长")
	}
	return nil
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

func (f *Service) EffectiveRoleIDs(ctx context.Context, userID int) ([]int, error) {
	assignments, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(userID)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[int]bool{}
	for _, assignment := range assignments {
		ids[assignment.RoleID] = true
	}
	memberships, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.UserIDEQ(userID)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, membership := range memberships {
		group, err := f.Store.Client.UserGroup.Get(ctx, membership.GroupID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if group.Status != "enabled" {
			continue
		}

		links, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, link := range links {
			ids[link.RoleID] = true
		}
	}
	result := make([]int, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	return result, nil
}

func (f *Service) AccessibleMenus(ctx context.Context, p *kernel.Principal) ([]*ent.Menu, error) {
	query := f.Store.Client.Menu.Query().Where(menu.StatusEQ("enabled"))
	if !p.SuperAdmin {
		ids := map[int]bool{}
		direct, err := f.Store.Client.UserMenu.Query().Where(usermenu.UserIDEQ(p.User.ID)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, grant := range direct {
			ids[grant.MenuID] = true
		}
		roles, err := f.EffectiveRoleIDs(ctx, p.User.ID)
		if err != nil {
			return nil, err
		}
		for _, id := range roles {
			_, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
			if ent.IsNotFound(err) {
				continue
			}
			if err != nil {
				return nil, err
			}

			grants, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(id)).All(ctx)
			if err != nil {
				return nil, err
			}
			for _, grant := range grants {
				ids[grant.MenuID] = true
			}
		}
		if len(ids) == 0 {
			return []*ent.Menu{}, nil
		}
		selected := make([]int, 0, len(ids))
		for id := range ids {
			selected = append(selected, id)
		}
		query = query.Where(menu.IDIn(selected...))
	}
	rows, err := query.Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (f *Service) Permissions(ctx context.Context, p *kernel.Principal) ([]string, error) {
	if p.SuperAdmin {
		return []string{"*"}, nil
	}
	rows, err := f.AccessibleMenus(ctx, p)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, row := range rows {
		if row.Permission != nil && *row.Permission != "" {
			set[*row.Permission] = true
		}
	}
	result := make([]string, 0, len(set))
	for permission := range set {
		result = append(result, permission)
	}
	return result, nil
}

func (f *Service) Permitted(ctx context.Context, p *kernel.Principal, permission string) (bool, error) {
	if !p.KeyAllows(permission) {
		return false, nil
	}
	if p.SuperAdmin {
		return true, nil
	}
	permissions, err := f.Permissions(ctx, p)
	if err != nil {
		return false, err
	}
	for _, candidate := range permissions {
		if candidate == permission {
			return true, nil
		}
	}
	return false, nil
}

func (f *Service) UserDataPredicate(ctx context.Context, p *kernel.Principal) (predicate.User, error) {
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
	ids, err := f.EffectiveRoleIDs(ctx, p.User.ID)
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
		rows, err := f.Store.Client.Department.Query().Where(kernel.DepartmentScope(p)).All(ctx)
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

func (f *Service) VisibleUser(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error) {
	scope, err := f.UserDataPredicate(ctx, p)
	if err != nil {
		return nil, err
	}
	predicates := []predicate.User{user.IDEQ(id), kernel.UserScope(p)}
	if scope != nil {
		predicates = append(predicates, scope)
	}
	return f.Store.Client.User.Query().Where(predicates...).Only(ctx)
}

func (f *Service) UserEffectivePermissions(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	account, _, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
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
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
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
	return kernel.Success(200, map[string]any{"directMenuIds": sortedIDs(direct), "roleMenuIds": sortedIDs(roleMenus), "groupMenuIds": sortedIDs(groupMenus), "effectiveMenuIds": sortedIDs(allMenus), "userDataScope": account.UserDataScope, "roleDataScope": widestScope(rolesScopes), "groupDataScope": widestScope(groupScopes), "effectiveDataScope": effective, "userDeptScopeIds": sortedIDs(userDepts), "roleDeptScopeIds": sortedIDs(roleDepts), "groupDeptScopeIds": sortedIDs(groupDepts), "effectiveDeptScopeIds": sortedIDs(allDepts), "groups": groups, "inheritedRoles": inheritedList, "menuSources": sources})
}

func (f *Service) ValidateGrantMenus(ctx context.Context, p *kernel.Principal, ids []int) error {
	allowed, err := f.Permissions(ctx, p)
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
			return kernel.ErrGrantDenied
		}
	}
	return nil
}

func (f *Service) ValidateGrantScope(ctx context.Context, p *kernel.Principal, scope string, departments []int) error {
	if p.SuperAdmin {
		return nil
	}
	actor, err := f.UserDataPredicate(ctx, p)
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
		return kernel.ErrGrantDenied
	}
	for _, id := range departments {
		outside, err := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id), user.Not(actor)).Exist(ctx)
		if err != nil {
			return err
		}
		if outside {
			return kernel.ErrGrantDenied
		}
		// Require the department itself to be represented in the actor's range;
		// an empty department must never become a way to grant future access.
		inside, err := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(id), actor).Exist(ctx)
		if err != nil {
			return err
		}
		if !inside {
			return kernel.ErrGrantDenied
		}
	}
	return nil
}

func (f *Service) ValidateGrantRoles(ctx context.Context, p *kernel.Principal, ids []int) error {
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
		if err = f.ValidateGrantMenus(ctx, p, menus); err != nil {
			return err
		}
		departments, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(id)).Select(roledepartment.FieldDepartmentID).Ints(ctx)
		if err != nil {
			return err
		}
		if err = f.ValidateGrantScope(ctx, p, row.DataScope, departments); err != nil {
			return err
		}
	}
	return nil
}

func (f *Service) VisibleMemberQuery(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (*ent.UserQuery, error) {
	dataScope, err := f.UserDataPredicate(ctx, p)
	if err != nil {
		return nil, err
	}
	if dataScope != nil {
		query = query.Where(dataScope)
	}
	return query, nil
}

func (f *Service) MemberSummary(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (int, []map[string]any, error) {
	query, err := f.VisibleMemberQuery(ctx, p, query)
	if err != nil {
		return 0, nil, err
	}
	count, err := query.Clone().Count(ctx)
	if err != nil {
		return 0, nil, err
	}
	rows, err := query.Order(ent.Asc(user.FieldID)).Limit(5).All(ctx)
	if err != nil {
		return 0, nil, err
	}
	preview := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		preview = append(preview, map[string]any{"id": row.ID, "nickname": row.Nickname, "avatar": row.Avatar})
	}
	return count, preview, nil
}

func (f *Service) WriteMemberPreview(ctx context.Context, inArgs kernel.Input, query *ent.UserQuery) (kernel.Outcome, error) {
	page, err := kernel.PositiveInt(inArgs.Filter.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	size, err := kernel.PositiveInt(inArgs.Filter.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	query, err = f.VisibleMemberQuery(ctx, kernel.FromContext(ctx), query)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	if keyword := strings.TrimSpace(inArgs.Filter.Get("keyword")); keyword != "" {
		query = query.Where(user.Or(user.UsernameContainsFold(keyword), user.NicknameContainsFold(keyword)))
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Asc(user.FieldID)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, map[string]any{"id": row.ID, "username": row.Username, "nickname": row.Nickname, "avatar": row.Avatar})
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) ListMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.Store.Client.Menu.Query().Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if inArgs.Flat {
		list := make([]any, 0, len(rows))
		for _, row := range rows {
			list = append(list, kernel.MenuView(row))
		}
		return kernel.Success(200, list)
	}
	return kernel.Success(200, kernel.MenuTree(rows))
}

func (f *Service) UserMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.AccessibleMenus(ctx, kernel.FromContext(ctx))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	// Button grants authorize operations; their parents provide navigation only.
	// Do not expand accessibleMenus, which is also the source of API permissions.
	all, err := f.Store.Client.Menu.Query().Where(menu.StatusEQ("enabled")).Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	lookup := make(map[int]*ent.Menu, len(all))
	for _, row := range all {
		lookup[row.ID] = row
	}
	selected := map[int]bool{}
	for _, grant := range rows {
		seen := map[int]bool{}
		for row := grant; row != nil && !seen[row.ID]; row = lookup[row.ParentID] {
			seen[row.ID] = true
			if row.Type != "button" && row.Visible {
				selected[row.ID] = true
			}
		}
	}
	visible := make([]*ent.Menu, 0, len(selected))
	for _, row := range all {
		if selected[row.ID] {
			visible = append(visible, row)
		}
	}
	return kernel.Success(200, kernel.MenuTree(visible))
}

func (f *Service) GetMenu(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.Store.Client.Menu.Get(ctx, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "菜单不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, kernel.MenuView(row))
}

func (f *Service) SaveMenu(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	patch, err := decodeMenuPatch(inArgs.Body)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	p := kernel.FromContext(ctx)
	var saved *ent.Menu
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		in := menuInput{Type: "menu", Status: "enabled", Visible: true}
		if id != 0 {
			current, err := tx.Menu.Get(ctx, id)
			if err != nil {
				return err
			}
			in = menuInputFrom(current)
			if !p.SuperAdmin && current.Permission != nil && *current.Permission != "" {
				allowed, err := f.Permitted(ctx, p, *current.Permission)
				if err != nil {
					return err
				}
				if !allowed {
					return kernel.ErrGrantDenied
				}
			}

		}
		in, err = mergeMenuInput(in, patch)
		if err != nil {
			return err
		}
		if !p.SuperAdmin && in.Permission != nil && *in.Permission != "" {
			allowed, err := f.Permitted(ctx, p, *in.Permission)
			if err != nil {
				return err
			}
			if !allowed {
				return kernel.ErrGrantDenied
			}
		}
		if err := validateMenu(in); err != nil {
			return err
		}
		if err := validateMenuParent(ctx, tx, id, in.ParentID); err != nil {
			return err
		}
		if id != 0 && in.Type == "button" {
			hasChildren, err := tx.Menu.Query().Where(menu.ParentIDEQ(id)).Exist(ctx)
			if err != nil {
				return err
			}
			if hasChildren {
				return fmt.Errorf("%w: 有子菜单的节点不能改为按钮", errInvalidMenu)
			}
		}
		if id == 0 {
			saved, err = applyMenuCreate(tx.Menu.Create(), in).Save(ctx)
		} else {
			saved, err = applyMenuUpdate(tx.Menu.UpdateOneID(id), in).Save(ctx)
		}
		if err != nil {
			return err
		}
		action := "update"
		if id == 0 {
			action = "create"
		}
		return auditMenu(ctx, tx, p.User.ID, inArgs.TraceID, action, saved.ID)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "菜单不存在")
	}
	if errors.Is(err, kernel.ErrGrantDenied) {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	if errors.Is(err, errInvalidMenu) {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "menu_conflict", "菜单保存失败，请检查名称是否重复")
	}
	status := 200
	if id == 0 {
		status = 201
	}
	return kernel.Success(status, kernel.MenuView(saved))
}

func (f *Service) DeleteMenu(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		rows, err := tx.Menu.Query().All(ctx)
		if err != nil {
			return err
		}
		children := map[int][]int{}
		found := false
		for _, row := range rows {
			children[row.ParentID] = append(children[row.ParentID], row.ID)
			if row.ID == id {
				found = true
			}
		}
		if !found {
			return &ent.NotFoundError{}
		}
		ids := []int{id}
		seen := map[int]bool{id: true}
		for i := 0; i < len(ids); i++ {
			for _, child := range children[ids[i]] {
				if !seen[child] {
					ids = append(ids, child)
					seen[child] = true
				}
			}
		}
		if assigned, err := tx.UserMenu.Query().Where(usermenu.MenuIDIn(ids...)).Exist(ctx); err != nil {
			return err
		} else if assigned {
			return errMenuReferenced
		}
		links, err := tx.RoleMenu.Query().Where(rolemenu.MenuIDIn(ids...)).All(ctx)
		if err != nil {
			return err
		}
		for _, link := range links {
			role, err := tx.Role.Get(ctx, link.RoleID)
			if err != nil {
				return err
			}
			if role.Code != "super_admin" {
				return errMenuReferenced
			}
		}
		for i := len(ids) - 1; i >= 0; i-- {
			if err := tx.Menu.DeleteOneID(ids[i]).Exec(ctx); err != nil {
				return err
			}
		}
		return auditMenu(ctx, tx, p.User.ID, inArgs.TraceID, "delete", id)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "菜单不存在")
	}
	if errors.Is(err, errMenuReferenced) {
		return kernel.Outcome{}, kernel.Fail(409, "menu_referenced", err.Error())
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) RoleMemberPreview(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.ScopedRole(ctx, inArgs, kernel.FromContext(ctx), id); err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色不存在")
	}
	ids, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).Select(userrole.FieldUserID).Ints(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	return f.WriteMemberPreview(ctx, inArgs, f.Store.Client.User.Query().Where(user.IDIn(ids...)))
}

func (f *Service) ScopedRole(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int) (*ent.Role, error) {
	return f.Store.Client.Role.Query().Where(role.IDEQ(id), kernel.RoleScope(p)).Only(ctx)
}

func (f *Service) RoleView(ctx context.Context, inArgs kernel.Input, row *ent.Role) (map[string]any, error) {
	menus, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(row.ID)).All(ctx)
	if err != nil {
		return nil, err
	}
	menuIDs := make([]int, 0, len(menus))
	for _, link := range menus {
		menuIDs = append(menuIDs, link.MenuID)
	}
	departments, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(row.ID)).All(ctx)
	if err != nil {
		return nil, err
	}
	deptIDs := make([]int, 0, len(departments))
	for _, link := range departments {
		deptIDs = append(deptIDs, link.DepartmentID)
	}
	memberIDs, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(row.ID)).Select(userrole.FieldUserID).Ints(ctx)
	if err != nil {
		return nil, err
	}
	users, preview, err := f.MemberSummary(ctx, kernel.FromContext(ctx), f.Store.Client.User.Query().Where(user.IDIn(memberIDs...)))
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "status": row.Status, "dataScope": row.DataScope, "menuIds": menuIDs, "deptScopeIds": deptIDs, "userCount": users, "userPreview": preview, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Service) ListRoles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
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
	query, err := f.FilteredRoles(p, q)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.RoleView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) FilteredRoles(p *kernel.Principal, q kernel.Values) (*ent.RoleQuery, error) {
	query := f.Store.Client.Role.Query().Where(kernel.RoleScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(role.Or(role.NameContainsFold(keyword), role.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(role.StatusEQ(status))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return nil, err
			}
			if bound.end {
				query = query.Where(role.CreatedAtLTE(value))
			} else {
				query = query.Where(role.CreatedAtGTE(value))
			}
		}
	}
	return query.Order(ent.Desc(role.FieldID)), nil
}

func (f *Service) ExportRolesCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredRoles(kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	return kernel.CSV("roles.csv", []string{"ID", "角色名称", "角色编码", "描述", "状态", "创建时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			description := ""
			if row.Description != nil {
				description = *row.Description
			}
			result = append(result, []string{strconv.Itoa(row.ID), row.Name, row.Code, description, row.Status, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}

func (f *Service) AllRoles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.Store.Client.Role.Query().Where(kernel.RoleScope(kernel.FromContext(ctx)), role.StatusEQ("enabled")).Order(ent.Asc(role.FieldName)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.RoleView(ctx, inArgs, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, list)
}

func (f *Service) GetRole(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.ScopedRole(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.RoleView(ctx, inArgs, row)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) SaveRole(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	p := kernel.FromContext(ctx)
	in := kernel.RoleInput{Status: "enabled", DataScope: "all", DeptScopeIDs: []int{}}
	if id != 0 {
		current, err := f.ScopedRole(ctx, inArgs, p, id)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		if current.Code == "super_admin" {
			return kernel.Outcome{}, kernel.Fail(409, "protected_role", "不能修改系统超级管理员角色")
		}
		in = kernel.RoleInput{Name: current.Name, Code: current.Code, Description: current.Description, Status: current.Status, DataScope: current.DataScope}
		in.DeptScopeIDs, err = f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(id)).Select(roledepartment.FieldDepartmentID).Ints(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "角色范围查询失败")
		}
		currentMenus, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(id)).Select(rolemenu.FieldMenuID).Ints(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "角色权限查询失败")
		}
		if err = f.ValidateGrantMenus(ctx, p, currentMenus); err != nil {
			return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
		}

	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "角色内容无效")
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
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if err := validateRole(in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	seen := map[int]bool{}
	for _, departmentID := range in.DeptScopeIDs {
		if departmentID < 1 || seen[departmentID] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_department", "部门范围无效")
		}
		seen[departmentID] = true
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(departmentID), kernel.DepartmentScope(p)).Only(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_department", "部门不属于当前组织")
		}
	}
	if in.Code == "super_admin" {
		return kernel.Outcome{}, kernel.Fail(409, "protected_role", "不能通过页面创建系统超级管理员角色")
	}
	if err := f.ValidateGrantScope(ctx, p, in.DataScope, in.DeptScopeIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	var saved *ent.Role
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Role.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetDataScope(in.DataScope)

			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			saved, err = create.Save(ctx)
		} else {
			update := tx.Role.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status).SetDataScope(in.DataScope)
			if in.Description == nil {
				update.ClearDescription()
			} else {
				update.SetDescription(*in.Description)
			}
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		if deptChanged || id == 0 {
			if _, err = tx.RoleDepartment.Delete().Where(roledepartment.RoleIDEQ(saved.ID)).Exec(ctx); err != nil {
				return err
			}
			for _, departmentID := range in.DeptScopeIDs {
				if err = tx.RoleDepartment.Create().SetRoleID(saved.ID).SetDepartmentID(departmentID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("roles").SetResourceID(saved.ID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "role_conflict", err.Error())
	}
	view, err := f.RoleView(ctx, inArgs, saved)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) DeleteRole(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	row, err := f.ScopedRole(ctx, inArgs, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if row.Code == "super_admin" {
		return kernel.Outcome{}, kernel.Fail(409, "protected_role", "不能删除系统超级管理员角色")
	}
	used, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).Exist(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if used {
		return kernel.Outcome{}, kernel.Fail(409, "role_in_use", "角色仍有关联账号")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.Role.DeleteOneID(id).Exec(ctx); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("roles").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) RoleUsers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedRole(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色不存在")
	} else if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	links, err := f.Store.Client.UserRole.Query().Where(userrole.RoleIDEQ(id)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	result := make([]any, 0, len(links))
	for _, link := range links {
		account, err := f.VisibleUser(ctx, p, link.UserID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		result = append(result, map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname, "email": account.Email, "avatar": account.Avatar, "status": account.Status, "createdAt": account.CreatedAt, "updatedAt": account.UpdatedAt})
	}
	return kernel.Success(200, result)
}

func (f *Service) AssignRoleUsers(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	var in struct {
		UserIDs []int `json:"userIds"`
	}
	if err = kernel.DecodeBody(inArgs.Body, &in); err != nil || in.UserIDs == nil || len(in.UserIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "用户列表无效")
	}
	p := kernel.FromContext(ctx)
	seen := map[int]bool{}
	for _, userID := range in.UserIDs {
		if userID < 1 || seen[userID] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "用户 ID 无效或重复")
		}
		seen[userID] = true
		if _, err := f.VisibleUser(ctx, p, userID); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_user", "用户不在可管理范围")
		}
	}
	if err := f.ValidateGrantRoles(ctx, p, []int{id}); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	visible, err := f.VisibleMemberQuery(ctx, p, f.Store.Client.User.Query())
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	visibleIDs, err := visible.IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "成员查询失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		row, err := tx.Role.Query().Where(role.IDEQ(id), kernel.RoleScope(p)).Only(ctx)
		if err != nil {
			return err
		}
		if row.Code == "super_admin" {
			return errors.New("不能批量修改超级管理员成员")
		}
		for _, userID := range in.UserIDs {
			_, err := tx.User.Get(ctx, userID)
			if err != nil {
				return err
			}

		}
		if _, err = tx.UserRole.Delete().Where(userrole.RoleIDEQ(id), userrole.UserIDIn(visibleIDs...)).Exec(ctx); err != nil {
			return err
		}
		for _, userID := range in.UserIDs {
			if err = tx.UserRole.Create().SetRoleID(id).SetUserID(userID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("assign_users").SetResource("roles").SetResourceID(id)

		return log.Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色或用户不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "assign_conflict", err.Error())
	}
	return kernel.Success(200, nil)
}

func (f *Service) AssignRoleMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	var in struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err = kernel.DecodeBody(inArgs.Body, &in); err != nil || in.MenuIDs == nil || len(in.MenuIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "菜单列表无效")
	}
	p := kernel.FromContext(ctx)
	seen := map[int]bool{}
	for _, menuID := range in.MenuIDs {
		if menuID < 1 || seen[menuID] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "菜单 ID 无效或重复")
		}
		seen[menuID] = true
	}
	if err := f.ValidateGrantMenus(ctx, p, in.MenuIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		row, err := tx.Role.Query().Where(role.IDEQ(id), kernel.RoleScope(p)).Only(ctx)
		if err != nil {
			return err
		}
		if row.Code == "super_admin" {
			return errors.New("不能修改超级管理员菜单")
		}
		for _, menuID := range in.MenuIDs {
			if _, err = tx.Menu.Query().Where(menu.IDEQ(menuID), menu.StatusEQ("enabled")).Only(ctx); err != nil {
				return err
			}
		}
		if _, err = tx.RoleMenu.Delete().Where(rolemenu.RoleIDEQ(id)).Exec(ctx); err != nil {
			return err
		}
		for _, menuID := range in.MenuIDs {
			if err = tx.RoleMenu.Create().SetRoleID(id).SetMenuID(menuID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("assign_menus").SetResource("roles").SetResourceID(id)

		return log.Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "角色或菜单不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "assign_conflict", err.Error())
	}
	return kernel.Success(200, nil)
}

func (f *Service) Permits(ctx context.Context, inArgs kernel.Input, permission string) (bool, error) {
	p := kernel.FromContext(ctx)
	if p.SuperAdmin {
		return true, nil
	}
	permissions, err := f.Permissions(ctx, p)
	if err != nil {
		return false, err
	}
	for _, candidate := range permissions {
		if candidate == permission {
			return true, nil
		}
	}
	return false, nil
}

func (f *Service) GetUserMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	account, _, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	direct, err := f.Store.Client.UserMenu.Query().Where(usermenu.UserIDEQ(account.ID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	directIDs := make([]int, 0, len(direct))
	for _, item := range direct {
		directIDs = append(directIDs, item.MenuID)
	}
	assignments, err := f.EffectiveRoleIDs(ctx, account.ID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	inherited := map[int]bool{}
	for _, assignment := range assignments {
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(assignment), role.StatusEQ("enabled")).Only(ctx)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}

		links, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(row.ID)).All(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		for _, link := range links {
			inherited[link.MenuID] = true
		}
	}
	roleIDs := make([]int, 0, len(inherited))
	for id := range inherited {
		roleIDs = append(roleIDs, id)
	}
	return kernel.Success(200, map[string]any{"directMenuIds": directIDs, "roleMenuIds": roleIDs})
}

func (f *Service) AssignUserMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	account, id, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	var in struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.MenuIDs == nil || len(in.MenuIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "菜单列表无效")
	}
	seen := map[int]bool{}
	for _, menuID := range in.MenuIDs {
		if menuID < 1 || seen[menuID] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "菜单 ID 无效或重复")
		}
		seen[menuID] = true
		if _, err := f.Store.Client.Menu.Query().Where(menu.IDEQ(menuID), menu.StatusEQ("enabled")).Only(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_menu", "菜单不可授权")
		}
	}
	p := kernel.FromContext(ctx)
	if err := f.ValidateGrantMenus(ctx, p, in.MenuIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.UserMenu.Delete().Where(usermenu.UserIDEQ(account.ID)).Exec(ctx); err != nil {
			return err
		}
		for _, menuID := range in.MenuIDs {
			if err := tx.UserMenu.Create().SetUserID(account.ID).SetMenuID(menuID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("assign_menus").SetResource("users").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) AssignUserRoles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	_, id, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	var in struct {
		RoleIDs []int `json:"roleIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.RoleIDs == nil || len(in.RoleIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "角色列表无效")
	}
	p := kernel.FromContext(ctx)
	if err := f.ValidateGrantRoles(ctx, p, in.RoleIDs); err != nil {
		return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
	}
	protected, err := f.deps.ProtectedBatchUser(ctx, inArgs, id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权查询失败")
	}
	if protected {
		return kernel.Outcome{}, kernel.Fail(409, "protected_user", "不能移除系统超级管理员授权")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.UserRole.Delete().Where(userrole.UserIDEQ(id)).Exec(ctx); err != nil {
			return err
		}
		for _, roleID := range in.RoleIDs {
			if err := tx.UserRole.Create().SetUserID(id).SetRoleID(roleID).Exec(ctx); err != nil {
				return err
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("assign_roles").SetResource("users").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "分配失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) GetUserDataPermission(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	account, _, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	links, err := f.Store.Client.UserDepartmentScope.Query().Where(userdepartmentscope.UserIDEQ(account.ID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
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
		row, err := f.Store.Client.Role.Query().Where(role.IDEQ(roleID), role.StatusEQ("enabled")).Only(ctx)
		if ent.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}

		*scopes = append(*scopes, row.DataScope)
		if row.DataScope == "custom" {
			links, err := f.Store.Client.RoleDepartment.Query().Where(roledepartment.RoleIDEQ(roleID)).All(ctx)
			if err != nil {
				return err
			}
			for _, link := range links {
				depts[link.DepartmentID] = true
			}
		}
		return nil
	}
	directRoles, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(account.ID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	for _, link := range directRoles {
		if err := collect(link.RoleID, &directScopes, directDepts); err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
	}
	memberships, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.UserIDEQ(account.ID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	groups := make([]any, 0, len(memberships))
	for _, membership := range memberships {
		group, err := f.Store.Client.UserGroup.Get(ctx, membership.GroupID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		if group.Status != "enabled" {
			continue
		}
		groups = append(groups, map[string]any{"id": group.ID, "name": group.Name})
		groupRoles, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).All(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		for _, link := range groupRoles {
			if err := collect(link.RoleID, &groupScopes, groupDepts); err != nil {
				return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
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
	return kernel.Success(200, map[string]any{"userDataScope": account.UserDataScope, "deptScopeIds": ids,
		"roleDataScope": widestScope(directScopes), "roleDeptScopeIds": roleDeptIDs, "groupDataScope": widestScope(groupScopes), "groupDeptScopeIds": groupDeptIDs, "groups": groups})
}

func (f *Service) UpdateUserDataPermission(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	_, id, targetErr := f.UserGrantTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	var in struct {
		DataScope    *string `json:"dataScope"`
		DeptScopeIDs []int   `json:"deptScopeIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.DeptScopeIDs == nil || len(in.DeptScopeIDs) > 5000 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "数据范围无效")
	}
	if in.DataScope != nil && !kernel.DataScopes[*in.DataScope] {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_scope", "数据范围无效")
	}
	p := kernel.FromContext(ctx)
	seen := map[int]bool{}
	for _, deptID := range in.DeptScopeIDs {
		if deptID < 1 || seen[deptID] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_department", "部门 ID 无效或重复")
		}
		seen[deptID] = true
		if _, err := f.Store.Client.Department.Query().Where(department.IDEQ(deptID), kernel.DepartmentScope(p)).Only(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_department", "部门不属于当前组织")
		}
	}
	if in.DataScope != nil {
		if err := f.ValidateGrantScope(ctx, p, *in.DataScope, in.DeptScopeIDs); err != nil {
			return kernel.Outcome{}, kernel.Fail(403, "grant_denied", err.Error())
		}
	}
	if (in.DataScope == nil || *in.DataScope != "custom") && len(in.DeptScopeIDs) > 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_scope", "仅自定义范围可以指定部门")
	}
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		update := tx.User.UpdateOneID(id)
		if in.DataScope == nil {
			update.ClearUserDataScope()
		} else {
			update.SetUserDataScope(*in.DataScope)
		}
		if err := update.Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.UserDepartmentScope.Delete().Where(userdepartmentscope.UserIDEQ(id)).Exec(ctx); err != nil {
			return err
		}
		if in.DataScope != nil && *in.DataScope == "custom" {
			for _, deptID := range in.DeptScopeIDs {
				if err := tx.UserDepartmentScope.Create().SetUserID(id).SetDepartmentID(deptID).Exec(ctx); err != nil {
					return err
				}
			}
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("set_data_scope").SetResource("users").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) UserGrantTarget(ctx context.Context, inArgs kernel.Input) (*ent.User, int, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return nil, 0, kernel.Fail(400, "invalid_id", err.Error())
	}
	account, err := f.deps.ScopedUser(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return nil, 0, kernel.Fail(404, "not_found", "账号不存在或超出管理范围")
	}
	if err != nil {
		return nil, 0, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return account, id, nil
}
func decodeMenuPatch(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(raw, &patch); err != nil {
		return nil, err
	}
	if len(patch) == 0 {
		return nil, fmt.Errorf("%w: 内容不能为空", errInvalidMenu)
	}
	allowed := map[string]bool{"parentId": true, "title": true, "name": true, "path": true, "component": true, "icon": true, "type": true, "permission": true, "query": true, "isExternal": true, "embed": true, "keepAlive": true, "sort": true, "status": true, "visible": true}
	for key := range patch {
		if !allowed[key] {
			return nil, fmt.Errorf("%w: 未知字段 %s", errInvalidMenu, key)
		}
	}
	return patch, nil
}
