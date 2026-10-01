//go:build integration

package zenith

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func legacyFixture(t *testing.T, version int) *Store {
	t.Helper()
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required")
	}
	s, err := OpenStore(context.Background(), isolatedTestDSN(t, dsn))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	ctx := context.Background()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, path := range []string{"migrations/0004_baseline_ent.sql", "migrations/0004_baseline_constraints.sql"} {
		if err := applyMigration(ctx, tx, path); err != nil {
			t.Fatal(err)
		}
	}
	if version == 3 {
		if _, err := tx.ExecContext(ctx, "DROP TABLE system_settings"); err != nil {
			t.Fatal(err)
		}
	}
	if version >= 5 {
		if err := applyMigration(ctx, tx, "migrations/0005_menu_fields.sql"); err != nil {
			t.Fatal(err)
		}
	}
	if version >= 6 {
		if err := applyMigration(ctx, tx, "migrations/0006_group_rules.sql"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.ExecContext(ctx, "CREATE TABLE zenith_schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO zenith_schema_versions(version) VALUES ($1)", version); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return s
}

func assertSingleSchema(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	var count int
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND column_name IN ('tenant_id','tenant_view_id')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("tenant columns remain: %d %v", count, err)
	}
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('tenants','tenant_packages','tenant_package_features')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("tenant entities remain: %d %v", count, err)
	}
	if err := s.DB.QueryRowContext(ctx, "SELECT max(version) FROM zenith_schema_versions").Scan(&count); err != nil || count != foundationSchemaVersion {
		t.Fatalf("version: %d %v", count, err)
	}
	var fk bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_department_fk' AND connamespace=current_schema()::regnamespace)`).Scan(&fk); err != nil || !fk {
		t.Fatalf("organization foreign key lost: %v", err)
	}
}

func TestPostgresVersionedMigrations(t *testing.T) {
	if strings.HasPrefix(os.Getenv("ZENITH_TEST_DATABASE_URL"), "sqlite:") {
		t.Skip("historical PostgreSQL upgrade paths; SQLite baseline is tested separately")
	}
	ctx := context.Background()
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required")
	}
	t.Run("empty", func(t *testing.T) {
		s, err := OpenStore(ctx, isolatedTestDSN(t, dsn))
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		assertSingleSchema(t, s)
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		if err := s.InitAdmin(ctx, "admin", "single-org-test-password-123"); err != nil {
			t.Fatal(err)
		}
		if err := s.Seed(ctx); err != nil {
			t.Fatal(err)
		}
		if count, err := s.Client.User.Query().Count(ctx); err != nil || count != 1 {
			t.Fatalf("seed changed accounts: %d %v", count, err)
		}
	})
	for _, version := range []int{3, 4, 5, 6} {
		t.Run(fmt.Sprintf("upgrade-v%d", version), func(t *testing.T) {
			s := legacyFixture(t, version)
			hash, err := bcrypt.GenerateFromPassword([]byte("preserved-admin-test-password"), bcrypt.MinCost)
			if err != nil {
				t.Fatal(err)
			}
			var id int
			if err := s.DB.QueryRowContext(ctx, `INSERT INTO users(username,nickname,password_hash,status,password_updated_at,created_at,updated_at) VALUES ('admin','Administrator',$1,'enabled',now(),now(),now()) RETURNING id`, string(hash)).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := s.DB.ExecContext(ctx, `INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,created_at) VALUES ($1,'migration-token','migration-csrf',now()+interval '1 day',now())`, id); err != nil {
				t.Fatal(err)
			}
			if err := s.Migrate(ctx); err != nil {
				t.Fatal(err)
			}
			assertSingleSchema(t, s)
			account, err := s.Client.User.Get(ctx, id)
			if err != nil || account.PasswordHash != string(hash) {
				t.Fatalf("admin credentials lost: %v", err)
			}
			sessions, err := s.Client.Session.Query().All(ctx)
			if err != nil || len(sessions) != 1 || sessions[0].RevokedAt == nil {
				t.Fatalf("old session not revoked: %v", err)
			}
			if err := s.Migrate(ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSingleOrganizationMigrationRefusesTenantData(t *testing.T) {
	if strings.HasPrefix(os.Getenv("ZENITH_TEST_DATABASE_URL"), "sqlite:") {
		t.Skip("historical PostgreSQL tenant migration; SQLite has no tenant baseline")
	}
	s := legacyFixture(t, 6)
	ctx := context.Background()
	var tenantID int
	if err := s.DB.QueryRowContext(ctx, `INSERT INTO tenants(name,code,status,created_at,updated_at) VALUES ('Other company','other-company','enabled',now(),now()) RETURNING id`).Scan(&tenantID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO positions(tenant_id,name,code,sort,status,created_at,updated_at) VALUES ($1,'Owned position','owned',0,'enabled',now(),now())`, tenantID); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err == nil || !strings.Contains(err.Error(), "tenant-owned data") {
		t.Fatalf("migration merged tenant data: %v", err)
	}
	var count int
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM positions WHERE tenant_id=$1", tenantID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("migration did not roll back: %d %v", count, err)
	}
	if err := s.DB.QueryRowContext(ctx, "SELECT max(version) FROM zenith_schema_versions").Scan(&count); err != nil || count != 6 {
		t.Fatalf("failed migration recorded: %d %v", count, err)
	}
}
