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
	return &Store{DB: db, Client: ent.NewClient(ent.Driver(driver)), driver: driver}, nil
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
