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
		{Method: "GET", Path: "/api/v1/settings", OperationID: "settingsList", Permission: "platform", Handler: http.HandlerFunc(f.listSettings)},
		{Method: "GET", Path: "/api/v1/settings/files", OperationID: "settingsGetFiles", Permission: "platform", Handler: http.HandlerFunc(f.getFileSettings)},
		{Method: "PUT", Path: "/api/v1/settings/files", OperationID: "settingsUpdateFiles", Permission: "platform", Handler: http.HandlerFunc(f.updateFileSettings)},
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
		{Method: "GET", Path: "/api/v1/positions/{id}/members", OperationID: "positionsMembers", Permission: "system:position:list", Handler: http.HandlerFunc(f.positionMembers)},
		{Method: "GET", Path: "/api/v1/positions/{id}/member-preview", OperationID: "positionsMemberPreview", Permission: "system:position:list", Handler: http.HandlerFunc(f.positionMemberPreview)},
		{Method: "PUT", Path: "/api/v1/positions/{id}/members", OperationID: "positionsSetMembers", Permission: "system:position:update", Handler: http.HandlerFunc(f.setPositionMembers)},
		{Method: "GET", Path: "/api/v1/users/all", OperationID: "usersAll", Permission: "system:user:list", Handler: http.HandlerFunc(f.allUsers)},
		{Method: "GET", Path: "/api/v1/users", OperationID: "usersList", Permission: "system:user:list", Handler: http.HandlerFunc(f.listUsers)},
		{Method: "GET", Path: "/api/v1/users/{id}", OperationID: "usersDetail", Permission: "system:user:list", Handler: http.HandlerFunc(f.getUser)},
		{Method: "POST", Path: "/api/v1/users", OperationID: "usersCreate", Permission: "system:user:create", Handler: http.HandlerFunc(f.saveUser)},
		{Method: "PUT", Path: "/api/v1/users/{id}", OperationID: "usersUpdate", Permission: "system:user:update", Handler: http.HandlerFunc(f.saveUser)},
		{Method: "PUT", Path: "/api/v1/users/{id}/password", OperationID: "usersResetPassword", Permission: "system:user:update", Handler: http.HandlerFunc(f.resetUserPassword)},
		{Method: "DELETE", Path: "/api/v1/users/{id}", OperationID: "usersRemove", Permission: "system:user:delete", Handler: http.HandlerFunc(f.deleteUser)},
		{Method: "GET", Path: "/api/v1/users/{id}/menus", OperationID: "usersMenus", Permission: "system:user:assign", Handler: http.HandlerFunc(f.getUserMenus)},
		{Method: "PUT", Path: "/api/v1/users/{id}/menus", OperationID: "usersAssignMenus", Permission: "system:user:assign", Handler: http.HandlerFunc(f.assignUserMenus)},
		{Method: "PUT", Path: "/api/v1/users/{id}/roles", OperationID: "usersAssignRoles", Permission: "system:user:assign", Handler: http.HandlerFunc(f.assignUserRoles)},
		{Method: "GET", Path: "/api/v1/users/{id}/data-permission", OperationID: "usersDataPermission", Permission: "system:user:assign", Handler: http.HandlerFunc(f.getUserDataPermission)},
		{Method: "PUT", Path: "/api/v1/users/{id}/data-permission", OperationID: "usersUpdateDataPermission", Permission: "system:user:assign", Handler: http.HandlerFunc(f.updateUserDataPermission)},
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
		{Method: "GET", Path: "/api/v1/user-groups", OperationID: "userGroupsList", Permission: "system:user-groups:list", Handler: http.HandlerFunc(f.listGroups)},
		{Method: "GET", Path: "/api/v1/user-groups/all", OperationID: "userGroupsAll", Permission: "system:user-groups:list", Handler: http.HandlerFunc(f.allGroups)},
		{Method: "POST", Path: "/api/v1/user-groups/rule-preview", OperationID: "userGroupsRulePreview", Permission: "authenticated", AnyPermissions: []string{"system:user-groups:create", "system:user-groups:update"}, Handler: http.HandlerFunc(f.previewGroupRule)},
		{Method: "GET", Path: "/api/v1/user-groups/{id}", OperationID: "userGroupsDetail", Permission: "system:user-groups:list", Handler: http.HandlerFunc(f.getGroup)},
		{Method: "POST", Path: "/api/v1/user-groups", OperationID: "userGroupsCreate", Permission: "system:user-groups:create", Handler: http.HandlerFunc(f.saveGroup)},
		{Method: "PUT", Path: "/api/v1/user-groups/{id}", OperationID: "userGroupsUpdate", Permission: "system:user-groups:update", Handler: http.HandlerFunc(f.saveGroup)},
		{Method: "DELETE", Path: "/api/v1/user-groups/{id}", OperationID: "userGroupsRemove", Permission: "system:user-groups:delete", Handler: http.HandlerFunc(f.deleteGroup)},
		{Method: "GET", Path: "/api/v1/user-groups/{id}/members", OperationID: "userGroupsMembers", Permission: "system:user-groups:list", Handler: http.HandlerFunc(f.groupMembers)},
		{Method: "PUT", Path: "/api/v1/user-groups/{id}/members", OperationID: "userGroupsSetMembers", Permission: "system:user-groups:assign", Handler: http.HandlerFunc(f.setGroupMembers)},
		{Method: "GET", Path: "/api/v1/user-groups/{id}/roles", OperationID: "userGroupsRoles", Permission: "system:user-groups:list", Handler: http.HandlerFunc(f.groupRoles)},
		{Method: "PUT", Path: "/api/v1/user-groups/{id}/roles", OperationID: "userGroupsSetRoles", Permission: "system:user-groups:assign", Handler: http.HandlerFunc(f.setGroupRoles)},
		{Method: "POST", Path: "/api/v1/user-groups/{id}/sync", OperationID: "userGroupsSync", Permission: "system:user-groups:assign", Handler: http.HandlerFunc(f.syncGroup)},
		{Method: "GET", Path: "/api/v1/dicts", OperationID: "dictsList", Permission: "system:dict:list", Handler: http.HandlerFunc(f.listDicts)},
		{Method: "GET", Path: "/api/v1/dicts/code/{code}/items", OperationID: "dictsItemsByCode", Permission: "authenticated", Handler: http.HandlerFunc(f.listDictItemsByCode)},
		{Method: "GET", Path: "/api/v1/dicts/{id}", OperationID: "dictsDetail", Permission: "system:dict:list", Handler: http.HandlerFunc(f.getDict)},
		{Method: "POST", Path: "/api/v1/dicts", OperationID: "dictsCreate", Permission: "system:dict:create", Handler: http.HandlerFunc(f.saveDict)},
		{Method: "PUT", Path: "/api/v1/dicts/{id}", OperationID: "dictsUpdate", Permission: "system:dict:update", Handler: http.HandlerFunc(f.saveDict)},
		{Method: "DELETE", Path: "/api/v1/dicts/{id}", OperationID: "dictsRemove", Permission: "system:dict:delete", Handler: http.HandlerFunc(f.deleteDict)},
		{Method: "GET", Path: "/api/v1/dicts/{id}/items", OperationID: "dictsItems", Permission: "system:dict:list", Handler: http.HandlerFunc(f.listDictItems)},
		{Method: "GET", Path: "/api/v1/dicts/{id}/items/{itemId}", OperationID: "dictsItemDetail", Permission: "system:dict:item", Handler: http.HandlerFunc(f.getDictItem)},
		{Method: "POST", Path: "/api/v1/dicts/{id}/items", OperationID: "dictsCreateItem", Permission: "system:dict:item", Handler: http.HandlerFunc(f.saveDictItem)},
		{Method: "PUT", Path: "/api/v1/dicts/{id}/items/{itemId}", OperationID: "dictsUpdateItem", Permission: "system:dict:item", Handler: http.HandlerFunc(f.saveDictItem)},
		{Method: "DELETE", Path: "/api/v1/dicts/{id}/items/{itemId}", OperationID: "dictsRemoveItem", Permission: "system:dict:item", Handler: http.HandlerFunc(f.deleteDictItem)},
		{Method: "GET", Path: "/api/v1/file-storage-configs", OperationID: "fileConfigsList", Permission: "system:file:config", Handler: http.HandlerFunc(f.listFileConfigs)},
		{Method: "GET", Path: "/api/v1/file-storage-configs/default", OperationID: "fileConfigsDefault", Permission: "system:file:config", Handler: http.HandlerFunc(f.defaultFileConfig)},
		{Method: "POST", Path: "/api/v1/file-storage-configs/test", OperationID: "fileConfigsTest", Permission: "system:file:config", Handler: http.HandlerFunc(f.testFileConfig)},
		{Method: "GET", Path: "/api/v1/file-storage-configs/{id}", OperationID: "fileConfigsDetail", Permission: "system:file:config", Handler: http.HandlerFunc(f.getFileConfig)},
		{Method: "POST", Path: "/api/v1/file-storage-configs", OperationID: "fileConfigsCreate", Permission: "system:file:config:create", Handler: http.HandlerFunc(f.saveFileConfig)},
		{Method: "PUT", Path: "/api/v1/file-storage-configs/{id}", OperationID: "fileConfigsUpdate", Permission: "system:file:config:update", Handler: http.HandlerFunc(f.saveFileConfig)},
		{Method: "PUT", Path: "/api/v1/file-storage-configs/{id}/default", OperationID: "fileConfigsSetDefault", Permission: "system:file:config:default", Handler: http.HandlerFunc(f.setDefaultFileConfig)},
		{Method: "DELETE", Path: "/api/v1/file-storage-configs/{id}", OperationID: "fileConfigsRemove", Permission: "system:file:config:delete", Handler: http.HandlerFunc(f.deleteFileConfig)},
		{Method: "GET", Path: "/api/v1/files/stats", OperationID: "filesStats", Permission: "system:file:list", Handler: http.HandlerFunc(f.fileStats)},
		{Method: "GET", Path: "/api/v1/files/upload-policy", OperationID: "filesUploadPolicy", Permission: "system:file:upload", Handler: http.HandlerFunc(f.fileUploadPolicy)},
		{Method: "GET", Path: "/api/v1/files", OperationID: "filesList", Permission: "system:file:list", Handler: http.HandlerFunc(f.listFiles)},
		{Method: "POST", Path: "/api/v1/files/upload-one", OperationID: "filesUploadOne", Permission: "system:file:upload", Handler: http.HandlerFunc(f.uploadOne)},
		{Method: "POST", Path: "/api/v1/files/upload/init", OperationID: "filesUploadInit", Permission: "system:file:upload", Handler: http.HandlerFunc(f.uploadInit)},
		{Method: "POST", Path: "/api/v1/files/upload/chunk", OperationID: "filesUploadChunk", Permission: "system:file:upload", Handler: http.HandlerFunc(f.uploadChunk)},
		{Method: "POST", Path: "/api/v1/files/upload/complete", OperationID: "filesUploadComplete", Permission: "system:file:upload", Handler: http.HandlerFunc(f.uploadComplete)},
		{Method: "GET", Path: "/api/v1/files/upload/{uploadId}/status", OperationID: "filesUploadStatus", Permission: "authenticated", Handler: http.HandlerFunc(f.uploadStatus)},
		{Method: "DELETE", Path: "/api/v1/files/upload/{uploadId}", OperationID: "filesUploadAbort", Permission: "system:file:upload", Handler: http.HandlerFunc(f.uploadAbort)},
		{Method: "GET", Path: "/api/v1/files/{id}/content", OperationID: "filesContent", Public: true, Handler: http.HandlerFunc(f.fileContent)},
		{Method: "GET", Path: "/api/v1/files/{id}/private-content", OperationID: "filesPrivateContent", Permission: "authenticated", Handler: http.HandlerFunc(f.privateFileContent)},
		{Method: "GET", Path: "/api/v1/files/{id}/access-url", OperationID: "filesAccessURL", Permission: "authenticated", Handler: http.HandlerFunc(f.accessFileURL)},
		{Method: "GET", Path: "/api/v1/files/{id}", OperationID: "filesDetail", Permission: "system:file:list", Handler: http.HandlerFunc(f.getFile)},
		{Method: "DELETE", Path: "/api/v1/files/{id}", OperationID: "filesRemove", Permission: "system:file:delete", Handler: http.HandlerFunc(f.deleteFile)},
	}
	for _, route := range routes {
		if err := r.Register(route); err != nil {
			return err
		}
	}
	for _, bound := range []struct {
		id      string
		handler http.Handler
	}{
		{"positionsList", http.HandlerFunc(f.listPositions)},
		{"positionsAll", http.HandlerFunc(f.allPositions)},
		{"positionsDetail", http.HandlerFunc(f.getPosition)},
		{"positionsCreate", http.HandlerFunc(f.createPosition)},
		{"positionsUpdate", http.HandlerFunc(f.updatePosition)},
		{"positionsRemove", http.HandlerFunc(f.deletePosition)},
		{"menusTree", http.HandlerFunc(f.listMenus)},
		{"menusFlat", http.HandlerFunc(f.listMenus)},
		{"menusDetail", http.HandlerFunc(f.getMenu)},
		{"menusCreate", http.HandlerFunc(f.saveMenu)},
		{"menusUpdate", http.HandlerFunc(f.saveMenu)},
		{"menusRemove", http.HandlerFunc(f.deleteMenu)},
		{"filesRemoveBatch", http.HandlerFunc(f.deleteFilesBatch)},
	} {
		if err := r.registerContract(bound.id, bound.handler); err != nil {
			return err
		}
	}
	if err := r.verifyContracts(); err != nil {
		return err
	}
	return nil
}
