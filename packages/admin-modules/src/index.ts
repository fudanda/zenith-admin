export const firstReleaseModules = [
  { key: 'home', path: '/', title: '工作台', permission: 'authenticated' },
  { key: 'profile', path: '/profile', title: '个人中心', permission: 'authenticated' },
  { key: 'positions', path: '/system/positions', title: '岗位管理', permission: 'system:position:list' },
  { key: 'departments', path: '/system/departments', title: '部门管理', permission: 'system:department:list' },
  { key: 'users', path: '/system/users', title: '账号管理', permission: 'system:user:list' },
  { key: 'roles', path: '/system/roles', title: '角色管理', permission: 'system:role:list' },
  { key: 'user-groups', path: '/system/user-groups', title: '用户组管理', permission: 'system:user-groups:list' },
  { key: 'tenants', path: '/system/tenants', title: '租户管理', permission: 'platform' },
  { key: 'tenant-packages', path: '/system/tenant-packages', title: '租户套餐', permission: 'platform' },
  { key: 'login-logs', path: '/system/login-logs', title: '登录日志', permission: 'system:log:login' },
  { key: 'operation-logs', path: '/system/operation-logs', title: '操作审计', permission: 'system:log:operation' },
] as const;
