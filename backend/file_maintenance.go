package zenith

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"log"
)

func (f *Framework) retryPendingFileDeletes(ctx context.Context) error {
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.DeletePending(true)).Limit(100).All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := f.removePendingFile(ctx, row); err != nil {
			log.Printf("file delete retry %s: %v", row.ID, err)
		}
	}
	return nil
}
