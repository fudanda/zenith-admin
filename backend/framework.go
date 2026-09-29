// Package zenith exposes an embeddable Go backend for Zenith Admin.
package zenith

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	gofrhttp "gofr.dev/pkg/gofr/http"
)

type Config struct {
	DSN           string
	Address       string
	SecureCookies bool
	Modules       []Module
}

type Module interface {
	Name() string
	Dependencies() []string
	Initialize(context.Context, *Registrar) error
	Shutdown(context.Context) error
}

type Route struct {
	Method, Path, OperationID, Permission string
	AnyPermissions                        []string
	Public, PlatformOnly                  bool
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
	key := route.Method + " " + route.Path
	if r.routes[key] || r.operations[route.OperationID] {
		return fmt.Errorf("duplicate route or operation %s", key)
	}
	r.routes[key], r.operations[route.OperationID] = true, true
	r.router.Add(route.Method, route.Path, r.guard(route))
	return nil
}

type Framework struct {
	Store             *Store
	config            Config
	handler           http.Handler
	modules           []Module
	server            *http.Server
	maintenanceCancel context.CancelFunc
	maintenanceDone   chan struct{}
	mu                sync.Mutex
	closed            bool
	active            int
	idle              chan struct{}
}

func orderModules(modules []Module) ([]Module, error) {
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

func New(ctx context.Context, config Config) (*Framework, error) {
	modules, err := orderModules(config.Modules)
	if err != nil {
		return nil, err
	}
	store, err := OpenStore(ctx, config.DSN)
	if err != nil {
		return nil, err
	}
	idle := make(chan struct{})
	close(idle)
	f := &Framework{Store: store, config: config, idle: idle}
	router := gofrhttp.NewRouter()
	reg := &Registrar{router: router, routes: map[string]bool{}, operations: map[string]bool{}, guard: f.guard}
	if err = f.registerCore(reg); err != nil {
		store.Close()
		return nil, err
	}
	for _, module := range modules {
		f.modules = append(f.modules, module)
		if err = module.Initialize(ctx, reg); err != nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			for i := len(f.modules) - 1; i >= 0; i-- {
				err = errors.Join(err, f.modules[i].Shutdown(cleanup))
			}
			cancel()
			return nil, errors.Join(err, store.Close())
		}
	}
	reg.sealed = true
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "not_found", "资源不存在")
	})
	f.handler = router
	f.startMaintenance()
	return f, nil
}

func (f *Framework) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !validRequestID(id) {
			value, err := secret()
			if err != nil {
				fail(w, 500, "random_unavailable", "请求不可用")
				return
			}
			id = value[:32]
		}
		w.Header().Set("X-Request-Id", id)
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
		f.mu.Lock()
		closed := f.closed
		if !closed {
			if f.active == 0 {
				f.idle = make(chan struct{})
			}
			f.active++
		}
		f.mu.Unlock()
		if closed {
			fail(w, 503, "shutting_down", "服务正在停止")
			return
		}
		defer func() {
			f.mu.Lock()
			f.active--
			if f.active == 0 {
				close(f.idle)
			}
			f.mu.Unlock()
		}()
		f.handler.ServeHTTP(w, r)
	})
}

type requestIDKey struct{}

func requestID(r *http.Request) string {
	value, _ := r.Context().Value(requestIDKey{}).(string)
	return value
}
func validRequestID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_') {
			return false
		}
	}
	return true
}

func (f *Framework) Run(ctx context.Context) error {
	address := f.config.Address
	if address == "" {
		address = ":8080"
	}
	srv := &http.Server{Addr: address, Handler: f.Handler(), ReadHeaderTimeout: 10 * time.Second}
	f.mu.Lock()
	if f.closed || f.server != nil {
		f.mu.Unlock()
		return errors.New("server already started or closed")
	}
	f.server = srv
	f.mu.Unlock()
	go func() {
		<-ctx.Done()
		stop, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = f.Shutdown(stop)
	}()
	err := srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (f *Framework) Shutdown(ctx context.Context) error {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil
	}
	f.closed = true
	srv := f.server
	idle := f.idle
	f.mu.Unlock()
	var err error
	if srv != nil {
		err = srv.Shutdown(ctx)
	}
	select {
	case <-idle:
	case <-ctx.Done():
		err = errors.Join(err, ctx.Err())
	}
	if f.maintenanceCancel != nil {
		f.maintenanceCancel()
		select {
		case <-f.maintenanceDone:
		case <-ctx.Done():
			err = errors.Join(err, ctx.Err())
		}
	}
	for i := len(f.modules) - 1; i >= 0; i-- {
		err = errors.Join(err, f.modules[i].Shutdown(ctx))
	}
	return errors.Join(err, f.Store.Close())
}

func (f *Framework) startMaintenance() {
	ctx, cancel := context.WithCancel(context.Background())
	f.maintenanceCancel = cancel
	f.maintenanceDone = make(chan struct{})
	go func() {
		defer close(f.maintenanceDone)
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				work, stop := context.WithTimeout(ctx, 30*time.Second)
				for _, statement := range []string{
					`DELETE FROM captchas WHERE expires_at < now() OR used_at IS NOT NULL`,
					`DELETE FROM sessions WHERE expires_at < now() OR revoked_at < now() - interval '7 days'`,
					`DELETE FROM login_attempts WHERE updated_at < now() - interval '1 day'`,
				} {
					if _, err := f.Store.DB.ExecContext(work, statement); err != nil {
						log.Printf("maintenance: %v", err)
					}
				}
				if err := f.retryPendingFileDeletes(work); err != nil {
					log.Printf("file maintenance: %v", err)
				}
				if err := f.cleanupExpiredUploads(work); err != nil {
					log.Printf("upload maintenance: %v", err)
				}
				if err := f.Store.reconcileDynamicGroups(work); err != nil {
					log.Printf("group maintenance: %v", err)
				}
				stop()
			}
		}
	}()
}

func (f *Framework) retryPendingFileDeletes(ctx context.Context) error {
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.DeletePending(true)).Limit(100).All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := f.removePendingFile(ctx, row); err != nil {
			log.Printf("file delete retry %s: %v", row.ID, err)
		}
	}
	return nil
}
