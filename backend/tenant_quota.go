package zenith

import (
	"context"
	"errors"
	"math"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/tenant"
	"github.com/fudanda/zenith-admin/backend/ent/user"
)

var errTenantSeatLimit = errors.New("该租户用户数已达上限")

// The tenant row lock serializes account creation for one tenant until the
// surrounding transaction commits, so the count and insert cannot race.
func reserveTenantSeat(ctx context.Context, tx *ent.Tx, tenantID *int) error {
	if tenantID == nil {
		return nil
	}
	row, err := tx.Tenant.Query().Where(tenant.IDEQ(*tenantID), func(selector *entsql.Selector) {
		selector.ForUpdate()
	}).Only(ctx)
	if err != nil {
		return err
	}
	limit := 0
	if row.MaxUsers != nil {
		limit = *row.MaxUsers
	}
	if row.PackageID != nil {
		pkg, err := tx.TenantPackage.Get(ctx, *row.PackageID)
		if err != nil {
			return err
		}
		if raw, exists := pkg.Quotas["maxUsers"]; exists && raw != nil {
			value, ok := raw.(float64)
			if !ok || value < 1 || math.Trunc(value) != value || value >= float64(math.MaxInt) {
				return errors.New("套餐用户数配额无效")
			}
			packageLimit := int(value)
			if limit == 0 || packageLimit < limit {
				limit = packageLimit
			}
		}
	}
	if limit == 0 {
		return nil
	}
	count, err := tx.User.Query().Where(user.TenantIDEQ(*tenantID)).Count(ctx)
	if err != nil {
		return err
	}
	if count >= limit {
		return errTenantSeatLimit
	}
	return nil
}
