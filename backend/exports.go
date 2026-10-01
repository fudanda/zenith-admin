package zenith

import (
	"context"

	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

func (s *services) export(ctx context.Context, entity string, input kernel.Input) (kernel.Outcome, error) {
	switch entity {
	case "system.users":
		return s.organization.ExportUsersCSV(ctx, input)
	case "system.departments":
		return s.organization.ExportDepartmentsCSV(ctx, input)
	case "system.roles":
		return s.authorization.ExportRolesCSV(ctx, input)
	case "system.dicts":
		return s.configuration.ExportDictsCSV(ctx, input)
	case "system.login-logs":
		return s.audit.ExportLoginLogsCSV(ctx, input)
	case "system.operation-logs":
		return s.audit.ExportAuditLogsCSV(ctx, input)
	case "system.file-storage-configs":
		return s.files.ExportFileConfigsCSV(ctx, input)
	case "system.positions":
		return s.positions.ExportCSV(ctx, input)
	}
	return kernel.Outcome{}, kernel.Fail(404, "not_found", "导出对象不存在")
}
