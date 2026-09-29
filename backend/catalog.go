package zenith

// Fixed first-release pages and operations. Seeded menu rows may be assigned
// to tenant roles and users; unshipped domains have no entries here.
type foundationMenu struct {
	Name, Title, Type, Path, Permission string
	Sort                                int
}

var foundationMenus = []foundationMenu{
	{Name: "home", Title: "工作台", Type: "menu", Path: "/", Sort: 10},
	{Name: "profile", Title: "个人中心", Type: "menu", Path: "/profile", Sort: 20},
	{Name: "positions", Title: "岗位管理", Type: "menu", Path: "/system/positions", Permission: "system:position:list", Sort: 100},
	{Name: "departments", Title: "部门管理", Type: "menu", Path: "/system/departments", Permission: "system:department:list", Sort: 110},
	{Name: "users", Title: "账号管理", Type: "menu", Path: "/system/users", Permission: "system:user:list", Sort: 120},
	{Name: "roles", Title: "角色管理", Type: "menu", Path: "/system/roles", Permission: "system:role:list", Sort: 130},
	{Name: "login_logs", Title: "登录日志", Type: "menu", Path: "/system/login-logs", Permission: "system:log:login", Sort: 180},
	{Name: "operation_logs", Title: "操作审计", Type: "menu", Path: "/system/operation-logs", Permission: "system:log:operation", Sort: 190},
	{Name: "tenants", Title: "租户管理", Type: "menu", Path: "/system/tenants", Sort: 200},
	{Name: "tenant_packages", Title: "租户套餐", Type: "menu", Path: "/system/tenant-packages", Sort: 210},
	{Name: "position_create", Title: "新增岗位", Type: "button", Permission: "system:position:create", Sort: 301},
	{Name: "position_update", Title: "修改岗位", Type: "button", Permission: "system:position:update", Sort: 302},
	{Name: "position_delete", Title: "删除岗位", Type: "button", Permission: "system:position:delete", Sort: 303},
	{Name: "department_create", Title: "新增部门", Type: "button", Permission: "system:department:create", Sort: 311},
	{Name: "department_update", Title: "修改部门", Type: "button", Permission: "system:department:update", Sort: 312},
	{Name: "department_delete", Title: "删除部门", Type: "button", Permission: "system:department:delete", Sort: 313},
	{Name: "user_create", Title: "新增账号", Type: "button", Permission: "system:user:create", Sort: 321},
	{Name: "user_update", Title: "修改账号", Type: "button", Permission: "system:user:update", Sort: 322},
	{Name: "user_delete", Title: "删除账号", Type: "button", Permission: "system:user:delete", Sort: 323},
	{Name: "user_assign", Title: "分配账号权限", Type: "button", Permission: "system:user:assign", Sort: 324},
	{Name: "role_create", Title: "新增角色", Type: "button", Permission: "system:role:create", Sort: 331},
	{Name: "role_update", Title: "修改角色", Type: "button", Permission: "system:role:update", Sort: 332},
	{Name: "role_delete", Title: "删除角色", Type: "button", Permission: "system:role:delete", Sort: 333},
	{Name: "role_assign", Title: "分配角色权限", Type: "button", Permission: "system:role:assign", Sort: 334},
	{Name: "menu_list", Title: "查看权限目录", Type: "button", Permission: "system:menu:list", Sort: 341},
}
