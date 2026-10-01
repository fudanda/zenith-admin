package zenith

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/internal/app"
	"time"
)

func (f *Framework) startMaintenance() {
	f.maintenance = app.StartMaintenance([]app.Task{
		{Name: "authentication", Run: func(ctx context.Context) error { return f.Store.cleanupAuthentication(ctx, time.Now().UTC()) }},
		{Name: "files", Run: f.retryPendingFileDeletes},
		{Name: "uploads", Run: f.cleanupExpiredUploads},
		{Name: "groups", Run: f.Store.reconcileDynamicGroups},
	}, 30*time.Minute, 30*time.Second)
}
