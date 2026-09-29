package zenith

import (
	"net/http"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/tenant"
)

func (f *Framework) switchTenantView(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	var in struct {
		TenantID *int `json:"tenantId"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", "租户视角无效")
		return
	}
	if in.TenantID != nil {
		if *in.TenantID < 1 {
			fail(w, 400, "invalid_request", "租户 ID 无效")
			return
		}
		_, err := f.Store.Client.Tenant.Query().Where(tenant.IDEQ(*in.TenantID), tenant.StatusEQ("enabled")).Only(r.Context())
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "租户不存在或已停用")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "切换失败")
			return
		}
	}
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		update := tx.Session.UpdateOneID(p.Session.ID)
		if in.TenantID == nil {
			update.ClearTenantViewID()
		} else {
			update.SetTenantViewID(*in.TenantID)
		}
		if err := update.Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("switch_tenant_view").SetResource("sessions").SetResourceID(p.Session.ID)
		if in.TenantID != nil {
			log.SetTenantID(*in.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "切换失败")
		return
	}
	respond(w, 200, map[string]any{"tenantViewId": in.TenantID})
}
