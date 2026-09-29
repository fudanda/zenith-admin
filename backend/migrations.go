package zenith

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
)

// These SQL files are reviewed snapshots of the Ent schema. Once released,
// migration files must remain immutable; new schema changes get a new version.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

const foundationSchemaVersion = 4

// Migrate is an explicit CLI operation. Serving requests never changes schema.
// Version 0 is a fresh database. Version 3 is the last pre-settings foundation
// schema and needs only the system_settings table. Existing version 4 databases
// are left untouched.
func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(922337203685470001)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS zenith_schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	var current int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM zenith_schema_versions`).Scan(&current); err != nil {
		return fmt.Errorf("read migration version: %w", err)
	}
	if current > foundationSchemaVersion {
		return fmt.Errorf("database schema version %d is newer than this binary", current)
	}
	switch current {
	case foundationSchemaVersion:
		return tx.Commit()
	case 0:
		var existing bool
		if err := tx.QueryRowContext(ctx, `SELECT to_regclass('users') IS NOT NULL`).Scan(&existing); err != nil {
			return err
		}
		if existing {
			return fmt.Errorf("unversioned Zenith schema exists; refusing to overwrite it")
		}
		for _, path := range []string{"migrations/0004_baseline_ent.sql", "migrations/0004_baseline_constraints.sql"} {
			if err := applyMigration(ctx, tx, path); err != nil {
				return err
			}
		}
	case 3:
		if err := applyMigration(ctx, tx, "migrations/0004_from_v3.sql"); err != nil {
			return err
		}
	default:
		return fmt.Errorf("database schema version %d has no supported upgrade path; restore its matching binary and migrate first", current)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO zenith_schema_versions(version) VALUES ($1)`, foundationSchemaVersion); err != nil {
		return fmt.Errorf("record migration version: %w", err)
	}
	return tx.Commit()
}

func applyMigration(ctx context.Context, tx *sql.Tx, path string) error {
	content, err := migrationFiles.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if _, err := tx.ExecContext(ctx, string(content)); err != nil {
		return fmt.Errorf("apply %s: %w", path, err)
	}
	return nil
}
