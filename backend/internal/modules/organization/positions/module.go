package positions

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler: handler} }
func (*Module) Name() string                   { return "organization.positions" }
func (*Module) Dependencies() []string         { return []string{"foundation-core"} }
func (*Module) Shutdown(context.Context) error { return nil }

func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	// Static collection actions always precede /{id}.
	for _, bound := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"positionsRemoveBatch", m.handler.DeleteBatch}, {"positionsExportCsv", m.handler.ExportCSV},
		{"positionsList", m.handler.List}, {"positionsAll", m.handler.All},
		{"positionsMembers", m.handler.Members}, {"positionsMemberPreview", m.handler.MemberPreview},
		{"positionsSetMembers", m.handler.SetMembers}, {"positionsDetail", m.handler.Detail},
		{"positionsCreate", m.handler.Create}, {"positionsUpdate", m.handler.Update}, {"positionsRemove", m.handler.Delete},
	} {
		if err := reg.RegisterContract(bound.id, bound.handler); err != nil {
			return err
		}
	}
	return nil
}
