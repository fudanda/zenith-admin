package httptransport

import (
	"errors"
	"fmt"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	gofrhttp "gofr.dev/pkg/gofr/http"
	"net/http"
	"strings"
)

type Route struct {
	Method, Path, OperationID, Permission string
	AnyPermissions                        []string
	APIKeyPermission                      string
	Public, SuperAdminOnly, APIKeyAllowed bool
	Handler                               http.Handler
}

type Registrar struct {
	router     *gofrhttp.Router
	routes     map[string]bool
	operations map[string]bool
	guard      func(Route) http.Handler
	sealed     bool
}

func (r *Registrar) Register(route Route) error {
	if r.sealed {
		return errors.New("route registration is closed")
	}
	if route.Method == "" || !strings.HasPrefix(route.Path, "/api/v1/") || route.OperationID == "" || route.Handler == nil || (!route.Public && route.Permission == "") {
		return errors.New("route requires method, /api/v1 path, operation ID, handler, and permission unless public")
	}
	if op, ok := contracts.Operations[route.OperationID]; ok {
		if route.APIKeyAllowed != op.APIKeyAllowed || route.APIKeyPermission != op.APIKeyPermission {
			return fmt.Errorf("API Key policy differs for %s", route.OperationID)
		}
		if route.Method != op.Method || route.Path != op.Path || route.Permission != op.Permission || route.Public != op.Public || route.SuperAdminOnly != op.SuperAdminOnly || strings.Join(route.AnyPermissions, ",") != strings.Join(op.AnyPermissions, ",") {
			return fmt.Errorf("route %s differs from its generated contract", route.OperationID)
		}
	}
	key := route.Method + " " + route.Path
	if r.routes[key] || r.operations[route.OperationID] {
		return fmt.Errorf("duplicate route or operation %s", key)
	}
	r.routes[key], r.operations[route.OperationID] = true, true
	r.router.Add(route.Method, route.Path, r.guard(route))
	return nil
}

func NewRegistrar(guard func(Route) http.Handler) *Registrar {
	router := gofrhttp.NewRouter()
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Fail(w, http.StatusNotFound, "not_found", "资源不存在")
	})
	return &Registrar{router: router, routes: map[string]bool{}, operations: map[string]bool{}, guard: guard}
}

func (r *Registrar) Handler() http.Handler { return r.router }
func (r *Registrar) Seal()                 { r.sealed = true }

// contractRoute binds a Go handler to method, path and permission generated
// from its shared Zod operation. Handler validation remains a runtime duty.
func contractRoute(id string, handler http.Handler) (Route, error) {
	op, ok := contracts.Operations[id]
	if !ok {
		return Route{}, fmt.Errorf("generated contract operation %q not found", id)
	}
	return Route{Method: op.Method, Path: op.Path, OperationID: id, Permission: op.Permission, AnyPermissions: op.AnyPermissions, Public: op.Public, APIKeyAllowed: op.APIKeyAllowed, APIKeyPermission: op.APIKeyPermission, SuperAdminOnly: op.SuperAdminOnly, Handler: handler}, nil
}

func (r *Registrar) RegisterContract(id string, handler http.Handler) error {
	route, err := contractRoute(id, handler)
	if err != nil {
		return err
	}
	return r.Register(route)
}

func (r *Registrar) VerifyContracts() error {
	for id := range contracts.Operations {
		if !r.operations[id] {
			return fmt.Errorf("generated contract operation %q has no Go handler", id)
		}
	}
	return nil
}
