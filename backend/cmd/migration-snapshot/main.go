// migration-snapshot is a one-off development tool for reviewing an Ent
// baseline against an empty PostgreSQL database. It is not used at runtime.
package main

import (
	"context"
	"log"
	"os"

	zenith "github.com/fudanda/zenith-admin/backend"
)

func main() {
	ctx := context.Background()
	store, err := zenith.OpenStore(ctx, os.Getenv("ZENITH_TEST_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	if err := os.MkdirAll("migrations", 0755); err != nil {
		log.Fatal(err)
	}
	file, err := os.Create("migrations/0001_ent_baseline.sql")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	if err := store.Client.Schema.WriteTo(ctx, file); err != nil {
		log.Fatal(err)
	}
}
