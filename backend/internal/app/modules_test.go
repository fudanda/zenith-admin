package app

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type cleanupModule struct {
	name                string
	initializationError error
	shutdownError       error
	events              *[]string
}

func (m cleanupModule) Name() string         { return m.name }
func (cleanupModule) Dependencies() []string { return nil }
func (m cleanupModule) Initialize(context.Context, *httptransport.Registrar) error {
	*m.events = append(*m.events, "init:"+m.name)
	return m.initializationError
}
func (m cleanupModule) Shutdown(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	*m.events = append(*m.events, "stop:"+m.name)
	return m.shutdownError
}

func TestInitializationFailureCleansPartialModuleInReverse(t *testing.T) {
	initErr, closeErr := errors.New("partial init failed"), errors.New("close failed")
	events := []string{}
	modules := []Module{
		cleanupModule{name: "first", events: &events, shutdownError: closeErr},
		cleanupModule{name: "partial", events: &events, initializationError: initErr},
		cleanupModule{name: "unused", events: &events},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := InitializeModules(ctx, modules, httptransport.NewRegistrar(nil))
	if !errors.Is(err, initErr) || !errors.Is(err, closeErr) {
		t.Fatalf("joined failures: %v", err)
	}
	if want := []string{"init:first", "init:partial", "stop:partial", "stop:first"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("cleanup order: %v", events)
	}
}

func TestContractCoverageFailureAlsoCleansModules(t *testing.T) {
	events := []string{}
	_, err := InitializeModules(context.Background(), []Module{cleanupModule{name: "incomplete", events: &events}}, httptransport.NewRegistrar(nil))
	if err == nil || !strings.Contains(err.Error(), "has no Go handler") {
		t.Fatalf("incomplete contracts accepted: %v", err)
	}
	if !reflect.DeepEqual(events, []string{"init:incomplete", "stop:incomplete"}) {
		t.Fatalf("coverage failure leaked module: %v", events)
	}
}
