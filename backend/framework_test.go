package zenith

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fudanda/zenith-admin/backend/internal/dash"
	gofrhttp "gofr.dev/pkg/gofr/http"
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
	reg := &Registrar{routes: map[string]bool{}, operations: map[string]bool{}, router: nil, guard: func(route Route) http.Handler { return route.Handler }}
	if err := reg.Register(Route{Method: "GET", Path: "/api/v1/x", OperationID: "x", Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})}); err == nil {
		t.Fatal("unprotected route accepted")
	}
}

func TestGoFrRoutesHealthAndUnknownAPI(t *testing.T) {
	f := &Framework{}
	router := gofrhttp.NewRouter()
	reg := &Registrar{routes: map[string]bool{}, operations: map[string]bool{}, router: router, guard: f.guard}
	if err := f.registerCore(reg); err != nil {
		t.Fatal(err)
	}
	router.Add(http.MethodGet, "/dash", dash.Handler())
	router.PathPrefix("/dash/").Handler(dash.Handler())
	for _, tc := range []struct {
		path   string
		status int
	}{{"/api/v1/health", 200}, {"/api/v1/missing", 404}} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if response.Code != tc.status {
			t.Errorf("%s: got %d, want %d", tc.path, response.Code, tc.status)
		}
	}
	for _, path := range []string{"/dash", "/dash/", "/dash/system/positions"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("Accept", "text/html")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Errorf("%s: got %d, want 200", path, response.Code)
		}
	}
}
