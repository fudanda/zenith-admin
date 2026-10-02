package main

import (
	"context"
	arcbase "github.com/fudanda/arcbase/backend"
	"github.com/fudanda/arcbase/backend/cli"
	"github.com/fudanda/arcbase/backend/examples/hostmodule"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Build the independent host with ARCBASE_HOST_BASE_PATH=/dash/ first.
	assets := os.DirFS(cli.Environment("ARCBASE_HOST_DIST"))
	app, err := arcbase.New(ctx, arcbase.Config{DSN: cli.Environment("ARCBASE_DATABASE_URL"), Address: cli.Environment("ARCBASE_ADDR"), SecureCookies: cli.Environment("ARCBASE_INSECURE_COOKIES") != "true", DashboardFS: assets, Modules: []arcbase.Module{&hostmodule.Module{}}, StorageEncryptionKey: cli.Environment("ARCBASE_STORAGE_KEY"), FileStagingPath: cli.Environment("ARCBASE_FILE_STAGING_PATH")})
	if err != nil {
		log.Fatal(err)
	}
	defer app.Shutdown(context.Background())
	if err = app.Run(ctx); err != nil {
		log.Fatal(err)
	}
}
