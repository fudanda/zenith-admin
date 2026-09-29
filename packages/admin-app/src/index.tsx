import { BrowserRouter, NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Button, Select, Spin, Toast } from '@douyinfe/semi-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { flattenTree } from '@zenith/shared/core';
import { menuContract, tenantContract, type Menu, type TenantOption } from '@zenith/shared/identity';
import { authApi, operation } from '@zenith/admin-client';
import { Providers, useAuth } from '@zenith/admin-core';
import { firstReleaseModules } from '@zenith/admin-modules';
import {
  HomePage, LoginPage, PositionsPage, ProfilePage, TenantsPage, TenantPackagesPage,
  LoginLogsPage, OperationLogsPage, DepartmentsPage, UsersPage, RolesPage,
  UserGroupsPage, MenusPage, DictsPage, FileConfigsPage, FilesPage, FileSettingsPage,
} from '@zenith/admin-pages';
import { ZenithMark } from '@zenith/admin-ui';

function Shell() {
  const { session, loading, error, can, logout, refresh } = useAuth();
  const queryClient = useQueryClient();
  const tenants = useQuery({
    queryKey: ['tenant-options'],
    queryFn: () => operation<TenantOption[]>(tenantContract.all),
    enabled: !!session?.superAdmin,
  });
  const menus = useQuery({
    queryKey: ['menus-user', session?.user.id, session?.tenantViewId],
    queryFn: () => operation<Menu[]>(menuContract.userTree),
    enabled: !!session,
  });
  const switchTenant = async (value: number | null) => {
    try {
      await authApi.switchTenantView(value);
      await refresh();
      queryClient.clear();
    } catch (reason) { Toast.error(String(reason)); }
  };
  if (loading) return <div className="zenith-login"><Spin size="large"/></div>;
  if (error) return <div className="zenith-login"><div className="zenith-card">{error}<Button onClick={() => location.reload()}>重试</Button></div></div>;
  if (!session) return <LoginPage/>;

  const visibleMenus = new Map(
    flattenTree(menus.data ?? []).filter(row => row.path && row.type === 'menu').map(row => [row.path!, row.title]),
  );
  const navigation = firstReleaseModules.filter(item => can(item.permission) && visibleMenus.has(item.path));
  return <div className="zenith-shell">
    <aside className="zenith-sidebar">
      <div className="zenith-brand"><ZenithMark/> Zenith Admin</div>
      <nav className="zenith-nav">
        {menus.isLoading && <Spin/>}
        {menus.isError && <p>菜单加载失败：{String(menus.error)}</p>}
        {navigation.map(item => <NavLink key={item.key} to={item.path} end={item.path === '/'}>
          {visibleMenus.get(item.path) ?? item.title}
        </NavLink>)}
      </nav>
    </aside>
    <div className="zenith-main">
      <header className="zenith-topbar">
        {session.superAdmin && <Select value={session.tenantViewId ?? 0}
          onChange={value => void switchTenant(Number(value) || null)} style={{ width: 180 }}
          optionList={[{ label: '平台视角', value: 0 }, ...(tenants.data ?? []).map(item => ({ label: item.name, value: item.id }))]}/>}
        <span>{session.user.nickname}</span>
        <Button theme="borderless" onClick={() => void logout().catch(reason => Toast.error(String(reason)))}>退出登录</Button>
      </header>
      <main className="zenith-content"><Routes>
        <Route path="/" element={<HomePage/>}/>
        <Route path="/profile" element={<ProfilePage/>}/>
        <Route path="/system/positions" element={can('system:position:list') ? <PositionsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/departments" element={can('system:department:list') ? <DepartmentsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/users" element={can('system:user:list') ? <UsersPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/roles" element={can('system:role:list') ? <RolesPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/menus" element={can('system:menu:list') ? <MenusPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/user-groups" element={can('system:user-groups:list') ? <UserGroupsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/dicts" element={can('system:dict:list') ? <DictsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/file-storage-configs" element={can('system:file:config') ? <FileConfigsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/files" element={can('system:file:list') ? <FilesPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/settings/files" element={can('platform') ? <FileSettingsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/tenants" element={can('platform') ? <TenantsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/tenant-packages" element={can('platform') ? <TenantPackagesPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/login-logs" element={can('system:log:login') ? <LoginLogsPage/> : <Navigate to="/" replace/>}/>
        <Route path="/system/operation-logs" element={can('system:log:operation') ? <OperationLogsPage/> : <Navigate to="/" replace/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes></main>
    </div>
  </div>;
}

export function App() { return <Providers><BrowserRouter basename="/dash"><Shell/></BrowserRouter></Providers>; }
