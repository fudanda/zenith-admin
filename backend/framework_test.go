package zenith

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type testModule struct {
	name         string
	dependencies []string
}

func (m testModule) Name() string                                 { return m.name }
func (m testModule) Dependencies() []string                       { return m.dependencies }
func (m testModule) Initialize(context.Context, *Registrar) error { return nil }
func (m testModule) Shutdown(context.Context) error               { return nil }

func TestModuleOrderAndCycle(t *testing.T) {
	ordered, err := orderModules([]Module{testModule{name: "b", dependencies: []string{"a"}}, testModule{name: "a"}})
	if err != nil || len(ordered) != 2 || ordered[0].Name() != "a" {
		t.Fatalf("dependency ordering failed: %v", err)
	}
	if _, err = orderModules([]Module{testModule{name: "a", dependencies: []string{"b"}}, testModule{name: "b", dependencies: []string{"a"}}}); err == nil {
		t.Fatal("cycle accepted")
	}
}

func TestRegistrarRejectsDuplicateAndMissingPermission(t *testing.T) {
	reg := httptransport.NewRegistrar(func(route Route) http.Handler { return route.Handler })
	if err := reg.Register(Route{Method: "GET", Path: "/api/v1/x", OperationID: "x", Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})}); err == nil {
		t.Fatal("unprotected route accepted")
	}
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	if err := reg.Register(Route{Method: "GET", Path: "/api/v1/x", OperationID: "x", Public: true, Handler: handler}); err != nil {
		t.Fatal(err)
	}
	for _, route := range []Route{
		{Method: "GET", Path: "/api/v1/x", OperationID: "other", Public: true, Handler: handler},
		{Method: "GET", Path: "/api/v1/other", OperationID: "x", Public: true, Handler: handler},
	} {
		if err := reg.Register(route); err == nil {
			t.Fatal("duplicate route/operation accepted")
		}
	}
	reg.Seal()
	if err := reg.Register(Route{Method: "GET", Path: "/api/v1/late", OperationID: "late", Public: true, Handler: handler}); err == nil {
		t.Fatal("registration remained open")
	}
}

func TestInvalidModulesRejectedBeforeOpeningDatabase(t *testing.T) {
	_, err := New(context.Background(), Config{Modules: []Module{testModule{name: "broken", dependencies: []string{"missing"}}}})
	if err == nil || !strings.Contains(err.Error(), "missing module dependency") {
		t.Fatalf("invalid module reached database initialization: %v", err)
	}
}

func TestGoFrRoutesHealthAndUnknownAPI(t *testing.T) {
	f := &Framework{services: assembleServices(nil, configuredFileStorage(Config{}))}
	reg := httptransport.NewRegistrar(f.guard)
	for _, module := range builtinModules(f.services) {
		if err := module.Initialize(context.Background(), reg); err != nil {
			t.Fatal(err)
		}
	}
	if err := reg.VerifyContracts(); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path   string
		status int
	}{{"/api/v1/health", 503}, {"/api/v1/missing", 404}, {"/dash", 404}, {"/dash/system/positions", 404}} {
		response := httptest.NewRecorder()
		reg.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if response.Code != tc.status {
			t.Errorf("%s: got %d, want %d", tc.path, response.Code, tc.status)
		}
	}
}
