// Package app owns application lifecycle, independently of domain services.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Module interface {
	Name() string
	Dependencies() []string
	Initialize(context.Context, *httptransport.Registrar) error
	Shutdown(context.Context) error
}

func OrderModules(modules []Module) ([]Module, error) {
	lookup := map[string]Module{}
	for _, m := range modules {
		if m == nil || m.Name() == "" {
			return nil, errors.New("module name is required")
		}
		if lookup[m.Name()] != nil {
			return nil, fmt.Errorf("duplicate module %s", m.Name())
		}
		lookup[m.Name()] = m
	}
	state := map[string]int{}
	ordered := make([]Module, 0, len(modules))
	var visit func(string) error
	visit = func(name string) error {
		m := lookup[name]
		if m == nil {
			return fmt.Errorf("missing module dependency %s", name)
		}
		if state[name] == 1 {
			return fmt.Errorf("cyclic module dependency %s", name)
		}
		if state[name] == 2 {
			return nil
		}
		state[name] = 1
		for _, dependency := range m.Dependencies() {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		state[name] = 2
		ordered = append(ordered, m)
		return nil
	}
	for _, m := range modules {
		if err := visit(m.Name()); err != nil {
			return nil, err
		}
	}
	return ordered, nil
}

// InitializeModules also cleans the failing module because it may own partial resources.
// Validation errors (such as an unregistered contract) follow the same cleanup path.
func InitializeModules(ctx context.Context, modules []Module, reg *httptransport.Registrar) ([]Module, error) {
	initialized := []Module{}
	var err error
	for _, m := range modules {
		initialized = append(initialized, m)
		if err = m.Initialize(ctx, reg); err != nil {
			break
		}
	}
	if err == nil {
		err = reg.VerifyContracts()
	}
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return nil, errors.Join(err, ShutdownModules(cleanup, initialized))
	}
	reg.Seal()
	return initialized, nil
}

func ShutdownModules(ctx context.Context, modules []Module) error {
	var err error
	for i := len(modules) - 1; i >= 0; i-- {
		err = errors.Join(err, modules[i].Shutdown(ctx))
	}
	return err
}
