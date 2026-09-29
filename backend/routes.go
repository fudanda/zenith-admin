package zenith

import (
	"context"
	"net/http"
	"time"
)

func (f *Framework) registerCore(r *Registrar) error {
	routes := []Route{
		{Method: "GET", Path: "/api/v1/health", OperationID: "health", Public: true, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })},
		{Method: "GET", Path: "/api/v1/ready", OperationID: "ready", Public: true, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
			defer cancel()
			if err := f.Store.DB.PingContext(ctx); err != nil {
				fail(w, 503, "database_unavailable", "数据库未就绪")
				return
			}
			respond(w, 200, map[string]string{"status": "ready"})
		})},
		{Method: "GET", Path: "/api/v1/stats", OperationID: "dashboardStats", Permission: "authenticated", Handler: http.HandlerFunc(f.dashboardStats)},
		{Method: "GET", Path: "/api/v1/login-logs", OperationID: "loginLogsList", Permission: "system:log:login", Handler: http.HandlerFunc(f.listLoginLogs)},
		{Method: "GET", Path: "/api/v1/operation-logs", OperationID: "operationLogsList", Permission: "system:log:operation", Handler: http.HandlerFunc(f.listAuditLogs)},
		{Method: "GET", Path: "/api/v1/auth/captcha", OperationID: "authCaptcha", Public: true, Handler: http.HandlerFunc(f.captcha)},
		{Method: "POST", Path: "/api/v1/auth/login", OperationID: "authLogin", Public: true, Handler: http.HandlerFunc(f.login)},
		{Method: "GET", Path: "/api/v1/auth/me", OperationID: "authMe", Permission: "authenticated", Handler: http.HandlerFunc(f.me)},
		{Method: "POST", Path: "/api/v1/auth/logout", OperationID: "authLogout", Permission: "authenticated", Handler: http.HandlerFunc(f.logout)},
		{Method: "PUT", Path: "/api/v1/auth/tenant-view", OperationID: "authTenantView", Permission: "platform", Handler: http.HandlerFunc(f.switchTenantView)},
		{Method: "PUT", Path: "/api/v1/auth/profile", OperationID: "authProfileUpdate", Permission: "authenticated", Handler: http.HandlerFunc(f.updateProfile)},
		{Method: "PUT", Path: "/api/v1/auth/preferences", OperationID: "authPreferencesUpdate", Permission: "authenticated", Handler: http.HandlerFunc(f.updatePreferences)},
		{Method: "POST", Path: "/api/v1/auth/password", OperationID: "authChangePassword", Permission: "authenticated", Handler: http.HandlerFunc(f.changePassword)},
		{Method: "GET", Path: "/api/v1/auth/sessions", OperationID: "authSessions", Permission: "authenticated", Handler: http.HandlerFunc(f.listSessions)},
		{Method: "DELETE", Path: "/api/v1/auth/sessions/{id}", OperationID: "authRevokeSession", Permission: "authenticated", Handler: http.HandlerFunc(f.revokeSession)},
		{Method: "GET", Path: "/api/v1/tenants", OperationID: "tenantsList", Permission: "platform", Handler: http.HandlerFunc(f.listTenants)},
		{Method: "GET", Path: "/api/v1/tenants/all", OperationID: "tenantsAll", Permission: "platform", Handler: http.HandlerFunc(f.allTenants)},
		{Method: "GET", Path: "/api/v1/tenants/{id}", OperationID: "tenantsDetail", Permission: "platform", Handler: http.HandlerFunc(f.getTenant)},
		{Method: "POST", Path: "/api/v1/tenants", OperationID: "tenantsCreate", Permission: "platform", Handler: http.HandlerFunc(f.createTenant)},
		{Method: "PUT", Path: "/api/v1/tenants/{id}", OperationID: "tenantsUpdate", Permission: "platform", Handler: http.HandlerFunc(f.updateTenant)},
		{Method: "GET", Path: "/api/v1/tenant-packages", OperationID: "tenantPackagesList", Permission: "platform", Handler: http.HandlerFunc(f.listPackages)},
		{Method: "GET", Path: "/api/v1/tenant-packages/all", OperationID: "tenantPackagesAll", Permission: "platform", Handler: http.HandlerFunc(f.allPackages)},
		{Method: "GET", Path: "/api/v1/tenant-packages/{id}", OperationID: "tenantPackagesDetail", Permission: "platform", Handler: http.HandlerFunc(f.getPackage)},
		{Method: "POST", Path: "/api/v1/tenant-packages", OperationID: "tenantPackagesCreate", Permission: "platform", Handler: http.HandlerFunc(f.savePackage)},
		{Method: "PUT", Path: "/api/v1/tenant-packages/{id}", OperationID: "tenantPackagesUpdate", Permission: "platform", Handler: http.HandlerFunc(f.savePackage)},
		{Method: "GET", Path: "/api/v1/positions", OperationID: "positionsList", Permission: "system:position:list", Handler: http.HandlerFunc(f.listPositions)},
		{Method: "GET", Path: "/api/v1/positions/all", OperationID: "positionsAll", Permission: "system:position:list", Handler: http.HandlerFunc(f.allPositions)},
		{Method: "GET", Path: "/api/v1/positions/{id}", OperationID: "positionsDetail", Permission: "system:position:list", Handler: http.HandlerFunc(f.getPosition)},
		{Method: "GET", Path: "/api/v1/positions/{id}/members", OperationID: "positionsMembers", Permission: "system:position:list", Handler: http.HandlerFunc(f.positionMembers)},
		{Method: "GET", Path: "/api/v1/positions/{id}/member-preview", OperationID: "positionsMemberPreview", Permission: "system:position:list", Handler: http.HandlerFunc(f.positionMemberPreview)},
		{Method: "POST", Path: "/api/v1/positions", OperationID: "positionsCreate", Permission: "system:position:create", Handler: http.HandlerFunc(f.createPosition)},
		{Method: "PUT", Path: "/api/v1/positions/{id}", OperationID: "positionsUpdate", Permission: "system:position:update", Handler: http.HandlerFunc(f.updatePosition)},
		{Method: "PUT", Path: "/api/v1/positions/{id}/members", OperationID: "positionsSetMembers", Permission: "system:position:update", Handler: http.HandlerFunc(f.setPositionMembers)},
		{Method: "DELETE", Path: "/api/v1/positions/{id}", OperationID: "positionsRemove", Permission: "system:position:delete", Handler: http.HandlerFunc(f.deletePosition)},
		{Method: "GET", Path: "/api/v1/users/all", OperationID: "usersAll", Permission: "system:user:list", Handler: http.HandlerFunc(f.allUsers)},
		{Method: "GET", Path: "/api/v1/users", OperationID: "usersList", Permission: "system:user:list", Handler: http.HandlerFunc(f.listUsers)},
		{Method: "GET", Path: "/api/v1/users/{id}", OperationID: "usersDetail", Permission: "system:user:list", Handler: http.HandlerFunc(f.getUser)},
		{Method: "POST", Path: "/api/v1/users", OperationID: "usersCreate", Permission: "system:user:create", Handler: http.HandlerFunc(f.saveUser)},
		{Method: "PUT", Path: "/api/v1/users/{id}", OperationID: "usersUpdate", Permission: "system:user:update", Handler: http.HandlerFunc(f.saveUser)},
		{Method: "PUT", Path: "/api/v1/users/{id}/password", OperationID: "usersResetPassword", Permission: "system:user:update", Handler: http.HandlerFunc(f.resetUserPassword)},
		{Method: "DELETE", Path: "/api/v1/users/{id}", OperationID: "usersRemove", Permission: "system:user:delete", Handler: http.HandlerFunc(f.deleteUser)},
		{Method: "GET", Path: "/api/v1/departments", OperationID: "departmentsTree", Permission: "system:department:list", Handler: http.HandlerFunc(f.treeDepartments)},
		{Method: "GET", Path: "/api/v1/departments/flat", OperationID: "departmentsFlat", Permission: "system:department:list", Handler: http.HandlerFunc(f.flatDepartments)},
		{Method: "GET", Path: "/api/v1/departments/{id}", OperationID: "departmentsDetail", Permission: "system:department:list", Handler: http.HandlerFunc(f.getDepartment)},
		{Method: "POST", Path: "/api/v1/departments", OperationID: "departmentsCreate", Permission: "system:department:create", Handler: http.HandlerFunc(f.saveDepartment)},
		{Method: "PUT", Path: "/api/v1/departments/{id}", OperationID: "departmentsUpdate", Permission: "system:department:update", Handler: http.HandlerFunc(f.saveDepartment)},
		{Method: "DELETE", Path: "/api/v1/departments/{id}", OperationID: "departmentsRemove", Permission: "system:department:delete", Handler: http.HandlerFunc(f.deleteDepartment)},
		{Method: "GET", Path: "/api/v1/roles", OperationID: "rolesList", Permission: "system:role:list", Handler: http.HandlerFunc(f.listRoles)},
		{Method: "GET", Path: "/api/v1/roles/all", OperationID: "rolesAll", Permission: "system:role:list", Handler: http.HandlerFunc(f.allRoles)},
		{Method: "GET", Path: "/api/v1/roles/{id}", OperationID: "rolesDetail", Permission: "system:role:list", Handler: http.HandlerFunc(f.getRole)},
		{Method: "POST", Path: "/api/v1/roles", OperationID: "rolesCreate", Permission: "system:role:create", Handler: http.HandlerFunc(f.saveRole)},
		{Method: "PUT", Path: "/api/v1/roles/{id}", OperationID: "rolesUpdate", Permission: "system:role:update", Handler: http.HandlerFunc(f.saveRole)},
		{Method: "DELETE", Path: "/api/v1/roles/{id}", OperationID: "rolesRemove", Permission: "system:role:delete", Handler: http.HandlerFunc(f.deleteRole)},
		{Method: "GET", Path: "/api/v1/roles/{id}/users", OperationID: "rolesUsers", Permission: "system:role:list", Handler: http.HandlerFunc(f.roleUsers)},
		{Method: "PUT", Path: "/api/v1/roles/{id}/users", OperationID: "rolesAssignUsers", Permission: "system:role:assign", Handler: http.HandlerFunc(f.assignRoleUsers)},
		{Method: "PUT", Path: "/api/v1/roles/{id}/menus", OperationID: "rolesAssignMenus", Permission: "system:role:assign", Handler: http.HandlerFunc(f.assignRoleMenus)},
		{Method: "GET", Path: "/api/v1/menus/user", OperationID: "menusUserTree", Permission: "authenticated", Handler: http.HandlerFunc(f.userMenus)},
		{Method: "GET", Path: "/api/v1/menus", OperationID: "menusTree", Permission: "system:menu:list", Handler: http.HandlerFunc(f.listMenus)},
		{Method: "GET", Path: "/api/v1/menus/flat", OperationID: "menusFlat", Permission: "system:menu:list", Handler: http.HandlerFunc(f.listMenus)},
		{Method: "GET", Path: "/api/v1/menus/{id}", OperationID: "menusDetail", Permission: "system:menu:list", Handler: http.HandlerFunc(f.getMenu)},
	}
	for _, route := range routes {
		if err := r.Register(route); err != nil {
			return err
		}
	}
	return nil
}
