package arcbase

import (
	"context"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/predicate"
	"github.com/fudanda/arcbase/backend/internal/security"
)

type positionAccess struct{ services *services }

func (a positionAccess) UserDataPredicate(ctx context.Context, p *security.Principal) (predicate.User, error) {
	return a.services.authorization.UserDataPredicate(ctx, p)
}
func (a positionAccess) SyncDynamicGroups(ctx context.Context, tx *ent.Tx, p *security.Principal) error {
	return a.services.usergroups.SyncDynamicGroupsInTx(ctx, tx, p)
}
