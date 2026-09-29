package zenith

import (
	"fmt"
	"net/http"

	"github.com/fudanda/zenith-admin/backend/internal/contracts"
)

// contractRoute binds a Go handler to method, path and permission generated
// from its shared Zod operation. Handler validation remains a runtime duty.
func contractRoute(id string, handler http.Handler) (Route, error) {
	op, ok := contracts.Operations[id]
	if !ok {
		return Route{}, fmt.Errorf("generated contract operation %q not found", id)
	}
	return Route{Method: op.Method, Path: op.Path, OperationID: id, Permission: op.Permission, Handler: handler}, nil
}

func (r *Registrar) registerContract(id string, handler http.Handler) error {
	route, err := contractRoute(id, handler)
	if err != nil {
		return err
	}
	return r.Register(route)
}

func (r *Registrar) verifyContracts() error {
	for id := range contracts.Operations {
		if !r.operations[id] {
			return fmt.Errorf("generated contract operation %q has no Go handler", id)
		}
	}
	return nil
}
