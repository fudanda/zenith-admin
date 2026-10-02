package data

import (
	"context"
	"database/sql"
	"entgo.io/ent/dialect"
	"fmt"
	"github.com/fudanda/arcbase/backend/migrations"
	"strings"
)

// These SQL files are reviewed snapshots of the Ent schema. Once released,
// migration files must remain immutable; new schema changes get a new version.
var migrationFiles = migrations.Files

const SchemaVersion = migrations.SchemaVersion

// Migrate is an explicit CLI operation. Serving requests never changes schema.
// Version 0 is a fresh database. Older foundation versions are upgraded in
// order; released SQL snapshots remain unchanged.
func (s *Store) Migrate(ctx context.Context) error {
	if s.Dialect == dialect.SQLite {
		return s.migrateSQLite(ctx)
	}
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
	if current > SchemaVersion {
		return fmt.Errorf("database schema version %d is newer than this binary", current)
	}
	switch current {
	case SchemaVersion:
		return tx.Commit()
	case 0:
		var existing bool
		if err := tx.QueryRowContext(ctx, `SELECT to_regclass('users') IS NOT NULL`).Scan(&existing); err != nil {
			return err
		}
		if existing {
			return fmt.Errorf("unversioned ArcBase schema exists; refusing to overwrite it")
		}
		for _, path := range []string{"migrations/0004_baseline_ent.sql", "migrations/0004_baseline_constraints.sql"} {
			if err := ApplyMigration(ctx, tx, path); err != nil {
				return err
			}
		}
	case 3:
		if err := ApplyMigration(ctx, tx, "migrations/0004_from_v3.sql"); err != nil {
			return err
		}
	case 4:
		// The v4 baseline is already present.
	case 5:
		// Menu columns are already present.
	case 9:
		// Login protection is already present.
	case 10:
		// Audit metadata is already present.
	case 8:
		// Session metadata is already present.
	case 7:
		// The single-organization schema is already present.
	case 6:
		// Upgrade the released multi-tenant foundation without rewriting it.
	default:
		return fmt.Errorf("database schema version %d has no supported upgrade path; restore its matching binary and migrate first", current)
	}
	if current < 5 {
		if err := ApplyMigration(ctx, tx, "migrations/0005_menu_fields.sql"); err != nil {
			return err
		}
	}
	if current < 6 {
		if err := ApplyMigration(ctx, tx, "migrations/0006_group_rules.sql"); err != nil {
			return err
		}
	}
	if current < 7 {
		if err := ApplyMigration(ctx, tx, "migrations/0007_single_organization.sql"); err != nil {
			return err
		}
	}
	if current < 8 {
		if err := ApplyMigration(ctx, tx, "migrations/0008_session_metadata.sql"); err != nil {
			return err
		}
	}
	if current < 9 {
		if err := ApplyMigration(ctx, tx, "migrations/0009_login_protection.sql"); err != nil {
			return err
		}
	}
	if current < 10 {
		if err := ApplyMigration(ctx, tx, "migrations/0010_audit_metadata.sql"); err != nil {
			return err
		}
	}
	if err := ApplyMigration(ctx, tx, "migrations/0011_integrations.sql"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO zenith_schema_versions(version) VALUES ($1)`, SchemaVersion); err != nil {
		return fmt.Errorf("record migration version: %w", err)
	}
	return tx.Commit()
}

func ApplyMigration(ctx context.Context, tx *sql.Tx, path string) error {
	content, err := migrationFiles.ReadFile(strings.TrimPrefix(path, "migrations/"))
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if _, err := tx.ExecContext(ctx, string(content)); err != nil {
		return fmt.Errorf("apply %s: %w", path, err)
	}
	return nil
}
