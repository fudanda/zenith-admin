package zenith

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/loginattempt"
	"github.com/fudanda/zenith-admin/backend/ent/position"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/modules/identity"
)

func sqliteStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(context.Background(), "sqlite:"+filepath.Join(t.TempDir(), "data", "zenith.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestSQLiteMigrationAndConstraints(t *testing.T) {
	ctx := context.Background()
	s := sqliteStore(t)
	if s.Dialect != dialect.SQLite {
		t.Fatal("SQLite was not selected")
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal("repeat migrate", err)
	}
	if err := s.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Seed(ctx); err != nil {
		t.Fatal("repeat seed", err)
	}
	if err := s.InitAdmin(ctx, "sqlite-admin", "SQLitePass123!"); err != nil {
		t.Fatal(err)
	}
	// Verify FK enforcement on several simultaneous pooled connections.
	var connsToClose []func() error
	defer func() {
		for _, close := range connsToClose {
			_ = close()
		}
	}()
	for i := 0; i < 4; i++ {
		conn, err := s.DB.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		connsToClose = append(connsToClose, conn.Close)
		var enabled int
		if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
			t.Fatalf("connection FK disabled: %d %v", enabled, err)
		}
	}
	if err := s.Client.UserRole.Create().SetUserID(999999).SetRoleID(1).Exec(ctx); err == nil {
		t.Fatal("orphan relation accepted")
	}
	if _, err := s.Client.Position.Create().SetName("one").SetCode("unique").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Client.Position.Create().SetName("two").SetCode("unique").Exec(ctx); !ent.IsConstraintError(err) {
		t.Fatal("duplicate code accepted", err)
	}
	abort := errors.New("rollback")
	if err := s.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.Position.Create().SetName("rollback").SetCode("rollback").Exec(ctx); err != nil {
			return err
		}
		return abort
	}); !errors.Is(err, abort) {
		t.Fatal(err)
	}
	if exists, err := s.Client.Position.Query().Where(position.CodeEQ("rollback")).Exist(ctx); err != nil || exists {
		t.Fatal("transaction did not roll back", err)
	}
	var journal string
	if err := s.DB.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journal); err != nil || journal != "wal" {
		t.Fatal("WAL not active", journal, err)
	}
}

func TestSQLiteRefusesUnknownSchema(t *testing.T) {
	ctx := context.Background()
	s := sqliteStore(t)
	if _, err := s.DB.ExecContext(ctx, "CREATE TABLE unrelated(secret text)"); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err == nil {
		t.Fatal("unversioned schema overwritten")
	}
	var count int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_schema WHERE name='zenith_schema_versions'").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration left ledger", count, err)
	}
	other := sqliteStore(t)
	if err := other.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := other.DB.ExecContext(ctx, "UPDATE zenith_schema_versions SET version=999"); err != nil {
		t.Fatal(err)
	}
	if err := other.Migrate(ctx); err == nil {
		t.Fatal("newer schema accepted")
	}
}

func TestSQLiteConcurrentMigrationAndLoginFailures(t *testing.T) {
	ctx := context.Background()
	dsn := "sqlite:" + filepath.Join(t.TempDir(), "concurrent.db")
	stores := make([]*Store, 2)
	for i := range stores {
		var err error
		stores[i], err = OpenStore(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		defer stores[i].Close()
	}
	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for _, s := range stores {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.Migrate(ctx) }()
	}
	wg.Wait()
	services := assembleServices(stores[0], configuredFileStorage(Config{}))
	policy := kernel.SecurityPolicy{}
	policy.LoginChallenge.WindowMinutes = 10
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- services.identity.RecordLoginFailure(ctx, "sqlite-user", "192.0.2.1", policy)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	row, err := stores[0].Client.LoginAttempt.Query().Where(loginattempt.KeyEQ(identity.SourceKey("sqlite-user", "192.0.2.1"))).Only(ctx)
	if err != nil || row.Failures != 20 {
		t.Fatal("lost concurrent failures", row, err)
	}
	if row.LockedUntil == nil || time.Until(*row.LockedUntil) < 9*time.Minute {
		t.Fatal("timestamp lost timezone", row)
	}
	// Expiry must compare instants rather than timezone-dependent strings.
	local := time.Now().In(time.FixedZone("UTC+8", 8*3600)).Add(-2 * time.Hour)
	if err := stores[0].Client.LoginAttempt.UpdateOne(row).SetUpdatedAt(local.Add(-24 * time.Hour)).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if err := services.identity.CleanupAuthentication(ctx, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if count, err := stores[0].Client.LoginAttempt.Query().Count(ctx); err != nil || count != 0 {
		t.Fatal("expired attempt not cleaned", count, err)
	}
}

func TestSQLiteSnapshotAndRestart(t *testing.T) {
	ctx := context.Background()
	s := sqliteStore(t)
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	row, err := s.Client.Position.Create().SetName("before snapshot").SetCode("snapshot").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "snapshot.db")
	if err := s.BackupSQLite(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err := s.BackupSQLite(ctx, backup); err == nil {
		t.Fatal("existing backup overwritten")
	}
	if err := s.Client.Position.UpdateOne(row).SetName("after snapshot").Exec(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err := OpenStore(ctx, "sqlite:"+backup)
	if err != nil {
		t.Fatal(err)
	}
	if err := recovered.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := recovered.Client.Position.Get(ctx, row.ID)
	if err != nil || got.Name != "before snapshot" {
		t.Fatal("snapshot does not contain original committed WAL data", got, err)
	}
	if err := recovered.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := New(ctx, Config{DSN: "sqlite:" + backup})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
}
