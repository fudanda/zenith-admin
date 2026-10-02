package data

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/fudanda/arcbase/backend/ent"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Store owns the only business connection pool. Services receive an explicit
// Ent transaction for multi-step writes rather than creating hidden pools.
type Store struct {
	DB           *sql.DB
	Client       *ent.Client
	Dialect      string
	driver       dialect.Driver
	dsn          string
	releaseLease func() error
}

func OpenStore(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("ARCBASE_DATABASE_URL is required")
	}
	db, dbDialect, err := openDatabase(dsn)
	if err != nil {
		return nil, err
	}
	if dbDialect == dialect.Postgres {
		db.SetMaxOpenConns(20)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(30 * time.Minute)
	} else {
		db.SetMaxOpenConns(8)
		db.SetMaxIdleConns(8)
	}
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("%s database: %w", dbDialect, err)
	}
	driver := entsql.OpenDB(dbDialect, db)
	client := ent.NewClient(ent.Driver(driver))
	return &Store{DB: db, Client: client, driver: driver, Dialect: dbDialect, dsn: dsn}, nil
}

func (s *Store) Close() error {
	var leaseErr error
	if s.releaseLease != nil {
		leaseErr = s.releaseLease()
		s.releaseLease = nil
	}
	return errors.Join(leaseErr, s.DB.Close())
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
