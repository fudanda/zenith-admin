package zenith

import (
	"context"
	"fmt"
)

// SQLite starts at the single-organization v10 baseline. It never runs the
// historical PostgreSQL/multi-tenant DDL. BEGIN IMMEDIATE locks the ledger across
// processes; schema and version are committed together.
func (s *Store) migrateSQLite(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS zenith_schema_versions (version integer PRIMARY KEY, applied_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		return err
	}
	var current int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version),0) FROM zenith_schema_versions`).Scan(&current); err != nil {
		return err
	}
	if current == foundationSchemaVersion {
		return tx.Commit()
	}
	if current != 0 {
		return fmt.Errorf("SQLite schema version %d is unsupported by this binary (expected %d)", current, foundationSchemaVersion)
	}
	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'zenith_schema_versions'`).Scan(&existing); err != nil {
		return err
	}
	if existing != 0 {
		return fmt.Errorf("unversioned SQLite schema exists; refusing to overwrite it")
	}
	if err := applyMigration(ctx, tx, "migrations/sqlite/0010_baseline.sql"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO zenith_schema_versions(version) VALUES (?)`, foundationSchemaVersion); err != nil {
		return err
	}
	return tx.Commit()
}
