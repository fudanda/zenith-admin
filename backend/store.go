package zenith

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/schema"
	"github.com/fudanda/zenith-admin/backend/ent"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Store owns the only business connection pool. Services receive an explicit
// Ent transaction for multi-step writes rather than creating hidden pools.
type Store struct {
	DB     *sql.DB
	Client *ent.Client
	driver dialect.Driver
}

func OpenStore(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("ZENITH_DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("PostgreSQL: %w", err)
	}
	driver := entsql.OpenDB(dialect.Postgres, db)
	return &Store{DB: db, Client: ent.NewClient(ent.Driver(driver)), driver: driver}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// Migrate is an explicit CLI operation. Schema.Create never runs during serve.
// It adds only missing tables/indexes/columns and refuses destructive changes.
func (s *Store) Migrate(ctx context.Context) error {
	// Session-level advisory locks belong to a physical connection. Pin that
	// connection until unlock; a pooled Exec may otherwise unlock a different one.
	lockConn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer lockConn.Close()
	if _, err := lockConn.ExecContext(ctx, "SELECT pg_advisory_lock(922337203685470001)"); err != nil {
		return err
	}
	defer lockConn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(922337203685470001)")
	if _, err := s.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS zenith_schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var current int
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM zenith_schema_versions`).Scan(&current); err != nil {
		return err
	}
	if current > 3 {
		return fmt.Errorf("database schema version %d is newer than this binary", current)
	}
	if current == 3 {
		return nil
	}
	if err := s.Client.Schema.Create(ctx, schema.WithDropColumn(false), schema.WithDropIndex(false)); err != nil {
		return err
	}
	indexes := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS users_platform_username_unique ON users(username) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS positions_platform_code_unique ON positions(code) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS departments_platform_code_unique ON departments(code) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS roles_platform_code_unique ON roles(code) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_groups_platform_code_unique ON user_groups(code) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS dicts_platform_code_unique ON dicts(code) WHERE tenant_id IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS file_storage_configs_default_unique ON file_storage_configs(is_default) WHERE is_default = true`,
	}
	for _, statement := range indexes {
		if _, err := s.DB.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	constraints := []struct{ name, statement string }{
		{"users_tenant_fk", `ALTER TABLE users ADD CONSTRAINT users_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"users_department_fk", `ALTER TABLE users ADD CONSTRAINT users_department_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL`},
		{"tenants_package_fk", `ALTER TABLE tenants ADD CONSTRAINT tenants_package_fk FOREIGN KEY (package_id) REFERENCES tenant_packages(id) ON DELETE RESTRICT`},
		{"tenant_package_features_package_fk", `ALTER TABLE tenant_package_features ADD CONSTRAINT tenant_package_features_package_fk FOREIGN KEY (package_id) REFERENCES tenant_packages(id) ON DELETE CASCADE`},
		{"departments_tenant_fk", `ALTER TABLE departments ADD CONSTRAINT departments_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"departments_leader_fk", `ALTER TABLE departments ADD CONSTRAINT departments_leader_fk FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE SET NULL`},
		{"positions_tenant_fk", `ALTER TABLE positions ADD CONSTRAINT positions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"user_positions_user_fk", `ALTER TABLE user_positions ADD CONSTRAINT user_positions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_positions_position_fk", `ALTER TABLE user_positions ADD CONSTRAINT user_positions_position_fk FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE`},
		{"roles_tenant_fk", `ALTER TABLE roles ADD CONSTRAINT roles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"sessions_user_fk", `ALTER TABLE sessions ADD CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_roles_user_fk", `ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_roles_role_fk", `ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE`},
		{"role_permissions_role_fk", `ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE`},
		{"role_menus_role_fk", `ALTER TABLE role_menus ADD CONSTRAINT role_menus_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE`},
		{"role_menus_menu_fk", `ALTER TABLE role_menus ADD CONSTRAINT role_menus_menu_fk FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE`},
		{"user_menus_user_fk", `ALTER TABLE user_menus ADD CONSTRAINT user_menus_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_menus_menu_fk", `ALTER TABLE user_menus ADD CONSTRAINT user_menus_menu_fk FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE`},
		{"role_departments_role_fk", `ALTER TABLE role_departments ADD CONSTRAINT role_departments_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE`},
		{"role_departments_department_fk", `ALTER TABLE role_departments ADD CONSTRAINT role_departments_department_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE`},
		{"user_permissions_user_fk", `ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_department_scopes_user_fk", `ALTER TABLE user_department_scopes ADD CONSTRAINT user_department_scopes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_department_scopes_department_fk", `ALTER TABLE user_department_scopes ADD CONSTRAINT user_department_scopes_department_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE`},
		{"user_groups_tenant_fk", `ALTER TABLE user_groups ADD CONSTRAINT user_groups_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"user_groups_owner_fk", `ALTER TABLE user_groups ADD CONSTRAINT user_groups_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL`},
		{"user_group_members_group_fk", `ALTER TABLE user_group_members ADD CONSTRAINT user_group_members_group_fk FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE`},
		{"user_group_members_user_fk", `ALTER TABLE user_group_members ADD CONSTRAINT user_group_members_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`},
		{"user_group_roles_group_fk", `ALTER TABLE user_group_roles ADD CONSTRAINT user_group_roles_group_fk FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE`},
		{"user_group_roles_role_fk", `ALTER TABLE user_group_roles ADD CONSTRAINT user_group_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE`},
		{"dicts_tenant_fk", `ALTER TABLE dicts ADD CONSTRAINT dicts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"dict_items_dict_fk", `ALTER TABLE dict_items ADD CONSTRAINT dict_items_dict_fk FOREIGN KEY (dict_id) REFERENCES dicts(id) ON DELETE CASCADE`},
		{"dict_items_parent_fk", `ALTER TABLE dict_items ADD CONSTRAINT dict_items_parent_fk FOREIGN KEY (parent_id) REFERENCES dict_items(id) ON DELETE SET NULL`},
		{"managed_files_storage_fk", `ALTER TABLE managed_files ADD CONSTRAINT managed_files_storage_fk FOREIGN KEY (storage_config_id) REFERENCES file_storage_configs(id) ON DELETE RESTRICT`},
		{"managed_files_tenant_fk", `ALTER TABLE managed_files ADD CONSTRAINT managed_files_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"managed_files_uploader_fk", `ALTER TABLE managed_files ADD CONSTRAINT managed_files_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE RESTRICT`},
		{"upload_sessions_storage_fk", `ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_storage_fk FOREIGN KEY (storage_config_id) REFERENCES file_storage_configs(id) ON DELETE RESTRICT`},
		{"upload_sessions_tenant_fk", `ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`},
		{"upload_sessions_uploader_fk", `ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_uploader_fk FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE RESTRICT`},
		{"upload_chunks_session_fk", `ALTER TABLE upload_chunks ADD CONSTRAINT upload_chunks_session_fk FOREIGN KEY (upload_id) REFERENCES upload_sessions(id) ON DELETE CASCADE`},
	}
	for _, constraint := range constraints {
		var exists bool
		if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname=$1)`, constraint.name).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if _, err := s.DB.ExecContext(ctx, constraint.statement); err != nil {
				return err
			}
		}
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO zenith_schema_versions(version) VALUES (3) ON CONFLICT DO NOTHING`)
	return err
}

func (s *Store) WithTx(ctx context.Context, work func(*ent.Tx) error) error {
	tx, err := s.Client.Tx(ctx)
	if err != nil {
		return err
	}
	if err = work(tx); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	return tx.Commit()
}
