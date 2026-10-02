package audit

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "audit" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"authMyOperationLogs", m.handler.MyOperationLogs},
		{"operationLogsExportCsv", m.handler.ExportAuditLogsCSV},
		{"operationLogsStats", m.handler.AuditStats},
		{"operationLogsClean", m.handler.CleanAuditLogs},
		{"authMyLoginLogs", m.handler.MyLoginLogs},
		{"loginLogsExportCsv", m.handler.ExportLoginLogsCSV},
		{"loginLogsStats", m.handler.LoginStats},
		{"loginLogsClean", m.handler.CleanLoginLogs},
		{"operationLogsList", m.handler.ListAuditLogs},
		{"loginLogsList", m.handler.ListLoginLogs},
		{"operationLogsDetail", m.handler.AuditLogDetail},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
