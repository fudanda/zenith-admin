package transfers

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "transfers" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"transferTemplate", m.handler.UserImportTemplate},
		{"transferUsers", m.handler.SyncUserImport},
		{"transferExport", m.handler.SyncExport},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
