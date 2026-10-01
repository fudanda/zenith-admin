package zenith

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/modules/organization/positions"
	"github.com/fudanda/zenith-admin/backend/internal/security"
	"net/http"
)

// positionAccess adapts existing authorization/group services without a reverse
// import from the extracted organization module to application assembly.
type positionAccess struct{ framework *Framework }

func (a positionAccess) UserDataPredicate(ctx context.Context, p *security.Principal) (predicate.User, error) {
	return a.framework.userDataPredicate(ctx, p)
}
func (a positionAccess) SyncDynamicGroups(ctx context.Context, tx *ent.Tx, p *security.Principal) error {
	return a.framework.syncDynamicGroupsInTx(ctx, tx, p)
}

func (f *Framework) positionService() *positions.Service {
	var store *data.Store
	if f.Store != nil {
		store = f.Store.Store
	}
	return positions.NewService(store, positionAccess{f})
}
func (f *Framework) positionHandler() *positions.Handler {
	return positions.NewHandler(f.positionService(), func(ctx context.Context) string {
		value, _ := ctx.Value(requestIDKey{}).(string)
		return value
	})
}

// Existing account association validation and synchronous transfer reuse the
// same domain implementation as the standalone position routes.
func (f *Framework) scopedPosition(ctx context.Context, _ *principal, id int) (*ent.Position, error) {
	return f.positionService().Scoped(ctx, id)
}
func (f *Framework) exportPositionsCsv(w http.ResponseWriter, r *http.Request) {
	f.positionHandler().ExportCSV(w, r)
}
