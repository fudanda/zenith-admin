package zenith

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

// HostData is supplied only to trusted Go modules. It borrows the single business
// pool, owns no connection lifecycle, and offers writes with mandatory audit.
type HostData struct{ store *data.Store }

func (s *Store) HostData() HostData { return HostData{s.Store} }
func (s HostData) Dialect() string  { return s.store.Dialect }

type borrowedDriver struct{ dialect.Driver }

func (borrowedDriver) Close() error { return nil }
func (s HostData) Driver() dialect.Driver {
	return borrowedDriver{entsql.OpenDB(s.store.Dialect, s.store.DB)}
}

type txDriver struct{ dialect.Driver }

func (txDriver) Close() error { return nil }

// Ent uses a transaction scope internally for UpdateOne + returning rows.
// It borrows the outer SQL transaction; only HostData.Write can commit it.
func (d txDriver) Tx(context.Context) (dialect.Tx, error) {
	return borrowedTx{d.Driver}, nil
}

type borrowedTx struct{ dialect.Driver }

func (borrowedTx) Commit() error   { return nil }
func (borrowedTx) Rollback() error { return nil }

// Write executes business persistence and audit in the same explicit transaction.
// The caller enforces its domain permission before entering this method.
func (s HostData) Write(ctx context.Context, module, operation, resource string, work func(dialect.Driver) (int, error)) error {
	actor, ok := CurrentActor(ctx)
	if !ok {
		return ErrUnauthenticated
	}
	if !moduleName.MatchString(module) || operation == "" || resource == "" || work == nil {
		return errors.New("host audit metadata is required")
	}
	tx, err := s.store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	driver := txDriver{entsql.NewDriver(s.store.Dialect, entsql.Conn{ExecQuerier: tx})}
	id, err := work(driver)
	if err != nil {
		return err
	}
	core := ent.NewClient(ent.Driver(driver))
	log := core.AuditLog.Create().SetActorID(actor.UserID).SetRequestID(actor.RequestID).SetModule(module).SetOperation(operation).SetResource(resource).SetResourceID(id).SetDescription("Host module " + operation)
	if meta, ok := kernel.Metadata(ctx); ok {
		log.SetMethod(meta.Method).SetPath(meta.Path).SetIP(meta.IP).SetUserAgent(meta.UserAgent).SetResponseCode(meta.SuccessStatus).SetDurationMs(int(time.Since(meta.Started).Milliseconds()))
		log.SetBrowser(kernel.BrowserName(meta.UserAgent)).SetOs(kernel.OsName(meta.UserAgent))
		if meta.Description != "" {
			log.SetDescription(meta.Description)
		}
	}
	if actor.APIKeyID > 0 {
		log.SetAPIKeyID(actor.APIKeyID)
	}
	if err = log.Exec(ctx); err != nil {
		return err
	}
	return tx.Commit()
}

type HostMigration struct {
	Version            int
	PostgreSQL, SQLite []string
}

func (s HostData) MigrateModule(ctx context.Context, module string, versions []HostMigration) error {
	if !moduleName.MatchString(module) || len(versions) == 0 {
		return errors.New("module migrations require a valid name and versions")
	}
	tx, err := s.store.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if s.store.Dialect == dialect.Postgres {
		if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(922337203685470005)"); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS zenith_host_module_versions (module VARCHAR(64) NOT NULL, version INTEGER NOT NULL, checksum VARCHAR(64) NOT NULL, PRIMARY KEY(module,version))`); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT version,checksum FROM zenith_host_module_versions WHERE module=$1 ORDER BY version`, module)
	if err != nil {
		return err
	}
	applied := map[int]string{}
	for rows.Next() {
		var n int
		var checksum string
		if err = rows.Scan(&n, &checksum); err != nil {
			rows.Close()
			return err
		}
		applied[n] = checksum
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(applied) > len(versions) {
		return errors.New("module database version is newer than this binary")
	}
	for index, migration := range versions {
		if migration.Version != index+1 {
			return errors.New("module migration versions must be contiguous from 1")
		}
		statements := migration.PostgreSQL
		if s.store.Dialect == dialect.SQLite {
			statements = migration.SQLite
		}
		if len(statements) == 0 {
			return errors.New("migration is missing a database dialect")
		}
		hash := sha256.Sum256([]byte(strings.Join(statements, "\n")))
		checksum := hex.EncodeToString(hash[:])
		if old, ok := applied[migration.Version]; ok {
			if old != checksum {
				return errors.New("published module migration changed")
			}
			continue
		}
		for _, statement := range statements {
			if _, err = tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("module %s migration %d failed", module, migration.Version)
			}
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO zenith_host_module_versions(module,version,checksum) VALUES($1,$2,$3)`, module, migration.Version, checksum); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s HostData) RequireModuleVersion(ctx context.Context, module string, version int) error {
	var current int
	if err := s.store.DB.QueryRowContext(ctx, `SELECT COALESCE(MAX(version),0) FROM zenith_host_module_versions WHERE module=$1`, module).Scan(&current); err != nil || current != version {
		return fmt.Errorf("module %s requires explicit migrate (expected %d)", module, version)
	}
	return nil
}

type HostMenuSeed struct {
	Name, Title, Permission, Path, Component, Type string
	ParentName                                     string
}

// SeedMenus is idempotent and preserves administrator edits; host navigation is
// registered by ZenithAdmin, while these rows allow original permission drawers.
func (s HostData) SeedMenus(ctx context.Context, module string, items []HostMenuSeed) error {
	if !moduleName.MatchString(module) {
		return errors.New("invalid module name")
	}
	return s.store.WithTx(ctx, func(tx *ent.Tx) error {
		for _, item := range items {
			if !strings.HasPrefix(item.Name, "host:"+module+":") || !strings.HasPrefix(item.Permission, "host:"+module+":") {
				return errors.New("host menu must use its module namespace")
			}
			exists, err := tx.Menu.Query().Where(menu.NameEQ(item.Name)).Exist(ctx)
			if err != nil {
				return err
			}
			if exists {
				continue
			}
			parent := 0
			if item.ParentName != "" {
				row, err := tx.Menu.Query().Where(menu.NameEQ(item.ParentName)).Only(ctx)
				if err != nil {
					return err
				}
				parent = row.ID
			}
			create := tx.Menu.Create().SetName(item.Name).SetTitle(item.Title).SetPermission(item.Permission).SetParentID(parent).SetType(item.Type).SetVisible(false).SetCreatedAt(time.Now()).SetUpdatedAt(time.Now())
			if item.Path != "" {
				create.SetPath(item.Path)
			}
			if item.Component != "" {
				create.SetComponent(item.Component)
			}
			if err = create.Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	})
}
