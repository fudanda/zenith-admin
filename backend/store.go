package zenith

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
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
	client := ent.NewClient(ent.Driver(driver))
	// Most domain writes create their audit row inside the same transaction. Fill
	// the active tenant view centrally so tenant-scoped log reads can see them.
	client.AuditLog.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if mutation.Op().Is(ent.OpCreate) {
				if audit, ok := mutation.(*ent.AuditLogMutation); ok {
					if _, set := audit.TenantID(); !set {
						if p := fromContext(ctx); p != nil && p.TenantID != nil {
							audit.SetTenantID(*p.TenantID)
						}
					}
				}
			}
			return next.Mutate(ctx, mutation)
		})
	})
	return &Store{DB: db, Client: client, driver: driver}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

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
