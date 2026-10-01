package zenith

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"entgo.io/ent/dialect"
	_ "modernc.org/sqlite"
)

// SQLite is selected explicitly by sqlite:PATH. Connection-level pragmas are
// enforced for every pooled connection, including after idle connections close.
// Immediate transactions serialize writers before they read a snapshot.
func openDatabase(dsn string) (*sql.DB, string, error) {
	if !strings.HasPrefix(dsn, "sqlite:") {
		db, err := sql.Open("pgx", dsn)
		return db, dialect.Postgres, err
	}
	path := strings.TrimPrefix(dsn, "sqlite:")
	if path == "" || path == ":memory:" || strings.ContainsAny(path, "?\x00") || strings.HasPrefix(path, "file:") {
		return nil, "", fmt.Errorf("SQLite requires a persistent file path: sqlite:./data/zenith.db (URI options are managed by the application)")
	}
	absolute, err := filepath.Abs(filepath.FromSlash(path))
	if err != nil {
		return nil, "", fmt.Errorf("SQLite path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, "", fmt.Errorf("SQLite directory: %w", err)
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, "", fmt.Errorf("SQLite file: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, "", err
	}
	query := url.Values{}
	query.Add("_pragma", "busy_timeout(10000)")
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "synchronous(FULL)")
	query.Set("_txlock", "immediate")
	// Preserve nanoseconds and compare instants correctly across UTC/local
	// time zones; datetime columns are decoded back to time.Time by the driver.
	query.Set("_time_integer_format", "unix_nano")
	query.Set("_inttotime", "1")
	uri := &url.URL{Scheme: "file", Path: filepath.ToSlash(absolute), RawQuery: query.Encode()}
	if !strings.HasPrefix(uri.Path, "/") {
		uri.Path = "/" + uri.Path // Windows drive letter in a file URI.
	}
	db, err := sql.Open("sqlite", uri.String())
	return db, dialect.SQLite, err
}
