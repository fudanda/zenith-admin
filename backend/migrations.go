package zenith

import (
	"context"
	"database/sql"
	"github.com/fudanda/zenith-admin/backend/internal/data"
)

const foundationSchemaVersion = data.SchemaVersion

// Historical upgrade fixtures share the exact runtime migration reader.
func applyMigration(ctx context.Context, tx *sql.Tx, path string) error {
	return data.ApplyMigration(ctx, tx, path)
}
