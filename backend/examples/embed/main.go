// Package main demonstrates mounting ArcBase inside an existing Go HTTP host.
// Apply migrations and seed data with cmd/arcbase before starting the host.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	arcbase "github.com/fudanda/arcbase/backend"
	"github.com/fudanda/arcbase/backend/cli"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := arcbase.New(ctx, arcbase.Config{
		DSN:           cli.Environment("ARCBASE_DATABASE_URL"),
		SecureCookies: cli.Environment("ARCBASE_INSECURE_COOKIES") != "true",
	})
	if err != nil {
		log.Fatal(err)
	}
	defer app.Shutdown(context.Background())

	mux := http.NewServeMux()
	mux.HandleFunc("GET /host-health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("/api/v1/", app.Handler())
	mux.Handle("/dash", app.Handler())
	mux.Handle("/dash/", app.Handler())

	server := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
	}()
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("HTTP serve: %v", err)
	}
}
