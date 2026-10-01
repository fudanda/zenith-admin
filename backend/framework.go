// Package zenith exposes an embeddable Go backend for Zenith Admin.
package zenith

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"sync"
	"time"

	"github.com/fudanda/zenith-admin/backend/internal/app"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/modules/audit"
	"github.com/fudanda/zenith-admin/backend/internal/storage"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Config struct {
	DSN                  string
	Address              string
	SecureCookies        bool
	Modules              []Module
	DashboardFS          fs.FS
	FileStorage          FileStorage
	StorageEncryptionKey string
	FileStagingPath      string
}

type Module = app.Module
type Route = httptransport.Route
type Registrar = httptransport.Registrar

var orderModules = app.OrderModules

type Framework struct {
	Store       *Store
	services    *services
	config      Config
	handler     http.Handler
	modules     []Module
	server      *http.Server
	maintenance *app.Maintenance
	mu          sync.Mutex
	closed      bool
	active      int
	idle        chan struct{}
}

func New(ctx context.Context, config Config) (*Framework, error) {
	// Check declarations before opening infrastructure. Real handlers are wired
	// only after the shared store is available.
	if _, err := orderModules(append(builtinDeclarations(), config.Modules...)); err != nil {
		return nil, err
	}
	extensions, err := describeExtensions(config.Modules)
	if err != nil {
		return nil, err
	}
	store, err := OpenStore(ctx, config.DSN)
	if err != nil {
		return nil, err
	}
	var version int
	if err = store.DB.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0) FROM zenith_schema_versions").Scan(&version); err != nil || version != foundationSchemaVersion {
		store.Close()
		return nil, fmt.Errorf("database migration required: run zenith migrate (expected version %d)", foundationSchemaVersion)
	}
	idle := make(chan struct{})
	close(idle)
	audit.InstallMetadataHooks(store.Store)
	key, keyErr := storage.SecretKey(config.StorageEncryptionKey)
	if keyErr != nil {
		store.Close()
		return nil, keyErr
	}
	f := &Framework{Store: store, config: config, idle: idle, services: assembleServices(store, configuredFileStorage(config))}
	f.services.files.EncryptionKey = key
	f.services.files.StagingPath = config.FileStagingPath
	f.configureExtensions(extensions)
	for _, module := range config.Modules {
		if binder, ok := module.(ServiceModule); ok {
			if err := binder.BindServices(f.HostServices()); err != nil {
				return nil, errors.Join(err, store.Close())
			}
		}
	}
	reg := httptransport.NewRegistrar(f.guard)
	modules, err := orderModules(append(builtinModules(f.services), config.Modules...))
	if err != nil {
		return nil, errors.Join(err, store.Close())
	}
	f.modules, err = app.InitializeModules(ctx, modules, reg)
	if err != nil {
		return nil, errors.Join(err, store.Close())
	}
	pages := []string{}
	for _, extension := range extensions {
		for _, page := range extension.Pages {
			pages = append(pages, page.Path)
		}
	}
	f.handler = dashboardHandler(reg.Handler(), config.DashboardFS, pages...)
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
		r = r.WithContext(kernel.WithTrace(r.Context(), id))
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
	f.services.integrations.Close()
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
	err = errors.Join(err, f.maintenance.Shutdown(ctx), app.ShutdownModules(ctx, f.modules))
	return errors.Join(err, f.Store.Close())
}
