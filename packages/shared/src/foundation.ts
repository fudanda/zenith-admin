/** Single-organization release scope. Original menu metadata comes from seed. */
export const foundationDictCodes = ['common_status', 'menu_type', 'menu_visible', 'user_gender', 'department_category'] as const;

export const foundationPages = [
  { path: '/', component: 'dashboard/DashboardPage', connected: true },
  { path: '/system/departments', component: 'system/departments/DepartmentsPage', connected: true },
  { path: '/system/positions', component: 'system/positions/PositionsPage', connected: true },
  { path: '/system/users', component: 'users/UsersPage', connected: true },
  { path: '/system/menus', component: 'system/menus/MenusPage', connected: true },
  { path: '/system/roles', component: 'system/roles/RolesPage', connected: true },
  { path: '/system/user-groups', component: 'system/user-groups/UserGroupsPage', connected: true },
  { path: '/system/dicts', component: 'system/dicts/DictsPage', connected: true },
  { path: '/system/settings', component: 'system/settings/SettingsPage', connected: true },
  { path: '/system/identity-security', component: 'system/identity-security/IdentitySecurityPage', connected: true },
  { path: '/system/file-configs', component: 'system/file-configs/FileStorageConfigsPage', connected: true },
  { path: '/system/files', component: 'system/files/FilesPage', connected: true },
  { path: '/system/sessions', component: 'system/sessions/OnlineSessionsPage', connected: true },
  { path: '/system/login-logs', component: 'system/login-logs/LoginLogsPage', connected: true },
  { path: '/system/operation-logs', component: 'system/operation-logs/OperationLogsPage', connected: true },
  { path: '/profile', component: 'profile/ProfilePage', connected: true },
] as const;
export const connectedFoundationPages = foundationPages.filter((page) => page.connected);
