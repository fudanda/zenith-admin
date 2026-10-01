package zenith

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/internal/data"
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
