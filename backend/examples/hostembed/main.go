package main

import (
	"context"
	zenith "github.com/fudanda/zenith-admin/backend"
	"github.com/fudanda/zenith-admin/backend/examples/hostmodule"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Build the independent host with ZENITH_HOST_BASE_PATH=/dash/ first.
	assets := os.DirFS(os.Getenv("ZENITH_HOST_DIST"))
	app, err := zenith.New(ctx, zenith.Config{DSN: os.Getenv("ZENITH_DATABASE_URL"), Address: os.Getenv("ZENITH_ADDR"), SecureCookies: os.Getenv("ZENITH_INSECURE_COOKIES") != "true", DashboardFS: assets, Modules: []zenith.Module{&hostmodule.Module{}}, StorageEncryptionKey: os.Getenv("ZENITH_STORAGE_KEY"), FileStagingPath: os.Getenv("ZENITH_FILE_STAGING_PATH")})
	if err != nil {
		log.Fatal(err)
	}
	defer app.Shutdown(context.Background())
	if err = app.Run(ctx); err != nil {
		log.Fatal(err)
	}
}
