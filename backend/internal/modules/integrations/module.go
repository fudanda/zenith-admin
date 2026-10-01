package integrations

import (
	"context"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
	"net/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module         { return &Module{handler} }
func (*Module) Name() string                     { return "integrations" }
func (*Module) Dependencies() []string           { return []string{"identity", "authorization", "audit"} }
func (m *Module) Shutdown(context.Context) error { m.handler.service.Close(); return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		if err := reg.Register(httptransport.Route{Method: method, Path: "/api/v1/mcp", OperationID: "mcpUnsupported" + method, Permission: "authenticated", APIKeyAllowed: true, Handler: http.HandlerFunc(m.handler.MCP)}); err != nil {
			return err
		}
	}
	if err := reg.RegisterContract("integrationEvents", http.HandlerFunc(m.handler.Events)); err != nil {
		return err
	}
	if err := reg.RegisterContract("integrationModules", http.HandlerFunc(m.handler.Modules)); err != nil {
		return err
	}
	return reg.RegisterContract("integrationMcp", http.HandlerFunc(m.handler.MCP))
}
