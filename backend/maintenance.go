package zenith

import (
	"context"
	"time"

	"github.com/fudanda/zenith-admin/backend/internal/app"
)

func (f *Framework) startMaintenance() {
	f.maintenance = app.StartMaintenance([]app.Task{
		{Name: "authentication", Run: func(ctx context.Context) error {
			return f.services.identity.CleanupAuthentication(ctx, time.Now().UTC())
		}},
		{Name: "files", Run: f.services.files.RetryPendingFileDeletes},
		{Name: "uploads", Run: f.services.files.CleanupExpiredUploads},
		{Name: "groups", Run: f.services.usergroups.ReconcileDynamicGroups},
	}, 30*time.Minute, 30*time.Second)
}
