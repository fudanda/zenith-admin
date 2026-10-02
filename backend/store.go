package arcbase

import (
	"context"

	"github.com/fudanda/arcbase/backend/internal/data"
)

// Store preserves the embedding API while infrastructure owns its connection pool.
type Store struct{ *data.Store }

func OpenStore(ctx context.Context, dsn string) (*Store, error) {
	store, err := data.OpenStore(ctx, dsn)
	if err != nil {
		return nil, err
	}
	return &Store{Store: store}, nil
}

// Seed and InitAdmin preserve the public embedding/CLI API while business
// initialization lives in the bootstrap domain.
func (s *Store) Seed(ctx context.Context) error {
	return assembleServices(s, configuredFileStorage(Config{})).bootstrap.Seed(ctx)
}
func (s *Store) InitAdmin(ctx context.Context, username, password string) error {
	return assembleServices(s, configuredFileStorage(Config{})).bootstrap.InitAdmin(ctx, username, password)
}

func (s *Store) ResetAdmin(ctx context.Context, username, password string) error {
	return assembleServices(s, configuredFileStorage(Config{})).bootstrap.ResetAdmin(ctx, username, password)
}
