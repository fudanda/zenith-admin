package authorization

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "authorization" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"rolesExportCsv", m.handler.ExportRolesCSV},
		{"menusUserTree", m.handler.UserMenus},
		{"menusFlat", m.handler.ListMenus},
		{"rolesAll", m.handler.AllRoles},
		{"menusTree", m.handler.ListMenus},
		{"menusCreate", m.handler.SaveMenu},
		{"rolesList", m.handler.ListRoles},
		{"rolesCreate", m.handler.SaveRole},
		{"usersEffectivePermissions", m.handler.UserEffectivePermissions},
		{"usersDataPermission", m.handler.GetUserDataPermission},
		{"usersUpdateDataPermission", m.handler.UpdateUserDataPermission},
		{"rolesMemberPreview", m.handler.RoleMemberPreview},
		{"usersMenus", m.handler.GetUserMenus},
		{"usersAssignMenus", m.handler.AssignUserMenus},
		{"usersAssignRoles", m.handler.AssignUserRoles},
		{"rolesAssignMenus", m.handler.AssignRoleMenus},
		{"rolesUsers", m.handler.RoleUsers},
		{"rolesAssignUsers", m.handler.AssignRoleUsers},
		{"menusDetail", m.handler.GetMenu},
		{"menusUpdate", m.handler.SaveMenu},
		{"menusRemove", m.handler.DeleteMenu},
		{"rolesDetail", m.handler.GetRole},
		{"rolesUpdate", m.handler.SaveRole},
		{"rolesRemove", m.handler.DeleteRole},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
