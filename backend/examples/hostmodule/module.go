// Package hostmodule demonstrates a business module importing only Zenith's public API.
package hostmodule

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	zenith "github.com/fudanda/zenith-admin/backend"
	"net/http"
	"strconv"
)

//go:embed contract.gen.json
var contractsJSON []byte

type Module struct{ services zenith.HostServices }

func (*Module) Name() string                                      { return "position-host" }
func (*Module) Dependencies() []string                            { return []string{"organization.positions"} }
func (*Module) Shutdown(context.Context) error                    { return nil }
func (m *Module) BindServices(services zenith.HostServices) error { m.services = services; return nil }
func (*Module) Extension() zenith.ExtensionDefinition {
	return zenith.ExtensionDefinition{Pages: []zenith.ExtensionPage{{ID: "positions", Path: "/extensions/position-host/positions", Permission: "system:position:list"}}, Permissions: []string{"host:position-host:create"}}
}
func (m *Module) Initialize(_ context.Context, reg *zenith.Registrar) error {
	var definitions []zenith.HostContract
	if err := json.Unmarshal(contractsJSON, &definitions); err != nil {
		return err
	}
	handlers := map[string]http.HandlerFunc{"hostPositionsList": m.list, "hostPositionsCreate": m.create}
	for _, op := range definitions {
		handler, ok := handlers[op.ID]
		if !ok {
			return errors.New("unknown host operation")
		}
		if err := zenith.RegisterHostContract(reg, op, handler); err != nil {
			return err
		}
	}
	return nil
}
func (m *Module) list(w http.ResponseWriter, r *http.Request) {
	page, size := 1, 10
	if value := r.URL.Query().Get("page"); value != "" {
		page, _ = strconv.Atoi(value)
	}
	if value := r.URL.Query().Get("pageSize"); value != "" {
		size, _ = strconv.Atoi(value)
	}
	// This example exposes keyword and pagination only; additional business filters
	// should be added to both its contract and its service input together.
	result, err := m.services.Positions.List(r.Context(), zenith.PositionFilter{Keyword: r.URL.Query().Get("keyword"), Status: r.URL.Query().Get("status")}, page, size)
	if err != nil {
		zenith.Fail(w, 503, "query_failed", "岗位查询失败")
		return
	}
	zenith.Respond(w, 200, result)
}
func (m *Module) create(w http.ResponseWriter, r *http.Request) {
	input := zenith.PositionInput{Status: "enabled"}
	if err := zenith.DecodeJSON(r, &input); err != nil {
		zenith.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := m.services.Positions.Create(r.Context(), input)
	if err != nil {
		if errors.Is(err, zenith.ErrForbidden) {
			zenith.Fail(w, 403, "forbidden", "没有岗位写权限")
			return
		}
		zenith.Fail(w, 409, "position_conflict", "岗位保存失败")
		return
	}
	zenith.Respond(w, 201, result)
}
