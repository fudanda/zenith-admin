package organization

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "organization" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"usersBatchResetPassword", m.handler.ResetUsersPasswordBatch},
		{"departmentsExportCsv", m.handler.ExportDepartmentsCSV},
		{"usersBatchStatus", m.handler.UpdateUsersStatusBatch},
		{"departmentsFlat", m.handler.FlatDepartments},
		{"usersExportCsv", m.handler.ExportUsersCSV},
		{"departmentsTree", m.handler.TreeDepartments},
		{"departmentsCreate", m.handler.SaveDepartment},
		{"usersRemoveBatch", m.handler.DeleteUsersBatch},
		{"usersAll", m.handler.AllUsers},
		{"usersList", m.handler.ListUsers},
		{"usersCreate", m.handler.SaveUser},
		{"departmentsMemberPreview", m.handler.DepartmentMemberPreview},
		{"usersResetPassword", m.handler.ResetUserPassword},
		{"usersUnlock", m.handler.UnlockUser},
		{"departmentsDetail", m.handler.GetDepartment},
		{"departmentsUpdate", m.handler.SaveDepartment},
		{"departmentsRemove", m.handler.DeleteDepartment},
		{"usersDetail", m.handler.GetUser},
		{"usersUpdate", m.handler.SaveUser},
		{"usersRemove", m.handler.DeleteUser},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
