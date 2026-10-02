package data

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"

	"entgo.io/ent/dialect"
	"github.com/gofrs/flock"
)

// Running services hold shared leases; combined backup/restore takes an exclusive
// lease. OS/connection locks are released even after an unclean process exit.
func (s *Store) AcquireLease(ctx context.Context, exclusive bool) error {
	if s.releaseLease != nil {
		return errors.New("database lease already held")
	}
	if s.Dialect == dialect.SQLite {
		path, err := filepath.Abs(strings.TrimPrefix(s.dsn, "sqlite:"))
		if err != nil {
			return err
		}
		lock := flock.New(path + ".maintenance.lock")
		var ok bool
		if exclusive {
			ok, err = lock.TryLock()
		} else {
			ok, err = lock.TryRLock()
		}
		if err != nil {
			_ = lock.Close()
			return err
		}
		if !ok {
			_ = lock.Close()
			return errors.New("database is in use; stop the service before backup, restore or migration")
		}
		var once sync.Once
		s.releaseLease = func() (err error) { once.Do(func() { err = lock.Close() }); return }
		return nil
	}
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	fn, unlock := "pg_try_advisory_lock_shared", "pg_advisory_unlock_shared"
	if exclusive {
		fn, unlock = "pg_try_advisory_lock", "pg_advisory_unlock"
	}
	var ok bool
	if err = conn.QueryRowContext(ctx, "SELECT "+fn+"(922337203685470003)").Scan(&ok); err != nil || !ok {
		_ = conn.Close()
		if err != nil {
			return err
		}
		return errors.New("database is in use; stop the service before backup, restore or migration")
	}
	var once sync.Once
	s.releaseLease = func() (result error) {
		once.Do(func() {
			_, err := conn.ExecContext(context.Background(), "SELECT "+unlock+"(922337203685470003)")
			result = errors.Join(err, conn.Close())
		})
		return
	}
	return nil
}
