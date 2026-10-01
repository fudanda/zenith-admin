package data

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"entgo.io/ent/dialect"
)

// BackupSQLite creates a consistent snapshot, including committed WAL writes.
// For a combined DB/files backup, pause application writes first and copy the
// configured file directory separately. Never copy only an active WAL DB file.
func (s *Store) BackupSQLite(ctx context.Context, target string) error {
	if s.Dialect != dialect.SQLite {
		return fmt.Errorf("backup-sqlite requires a SQLite database; use pg_dump for PostgreSQL")
	}
	if target == "" {
		return fmt.Errorf("backup-sqlite requires a new output path")
	}
	absolute, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return err
	}
	// Reserve a private empty file exclusively. VACUUM INTO accepts an empty
	// destination; concurrent backup commands must not overwrite each other.
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("backup target must be a new writable file: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(absolute)
		return err
	}
	_, err = s.DB.ExecContext(ctx, "VACUUM INTO ?", absolute)
	if err != nil {
		_ = os.Remove(absolute)
		return fmt.Errorf("SQLite backup: %w", err)
	}
	return os.Chmod(absolute, 0600)
}
