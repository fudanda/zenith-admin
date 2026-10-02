package arcbase

import (
	"context"
	"github.com/fudanda/arcbase/backend/migrations"
	"testing"
)

func TestSQLiteIntegrationUpgradePreservesRecords(t *testing.T) {
	store := sqliteStore(t)
	ctx := context.Background()
	sql, err := migrations.Files.ReadFile("sqlite/0010_baseline.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.ExecContext(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.ExecContext(ctx, `CREATE TABLE zenith_schema_versions(version integer PRIMARY KEY,applied_at datetime DEFAULT CURRENT_TIMESTAMP); INSERT INTO zenith_schema_versions(version) VALUES (10);`); err != nil {
		t.Fatal(err)
	}
	if err = store.Client.Position.Create().SetName("keep position").SetCode("keep_position").Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if err = store.InitAdmin(ctx, "upgrade-admin", "UpgradeAcceptance123!"); err != nil {
		t.Fatal(err)
	}
	before, err := store.Client.User.Query().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := store.Client.User.Get(ctx, before.ID)
	if err != nil || before.PasswordHash != after.PasswordHash {
		t.Fatal("existing admin changed", err)
	}
	if store.Client.Position.Query().CountX(ctx) != 1 {
		t.Fatal("existing record removed")
	}
	if _, err = store.Client.APIKey.Query().All(ctx); err != nil {
		t.Fatal("new entity missing", err)
	}
}
