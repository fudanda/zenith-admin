package zenith

import (
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
)

func (f *Framework) dashboardStats(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	ctx := r.Context()
	users := f.Store.Client.User.Query()
	if p.TenantID != nil {
		users = users.Where(user.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		users = users.Where(user.TenantIDIsNil())
	}
	userIDs, err := users.Clone().IDs(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "统计不可用")
		return
	}
	userCount := len(userIDs)
	active := 0
	if len(userIDs) > 0 {
		active, err = f.Store.Client.Session.Query().Where(session.UserIDIn(userIDs...), session.ExpiresAtGT(time.Now()), session.RevokedAtIsNil()).Count(ctx)
		if err != nil {
			fail(w, 503, "database_unavailable", "统计不可用")
			return
		}
	}
	now := time.Now()
	year, month, day := now.Date()
	start := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	logins := f.Store.Client.LoginLog.Query().Where(loginlog.CreatedAtGTE(start), loginlog.SuccessEQ(true))
	operations := f.Store.Client.AuditLog.Query().Where(auditlog.CreatedAtGTE(start))
	if p.TenantID != nil {
		logins = logins.Where(loginlog.TenantIDEQ(*p.TenantID))
		operations = operations.Where(auditlog.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		logins = logins.Where(loginlog.TenantIDIsNil())
		operations = operations.Where(auditlog.TenantIDIsNil())
	}
	loginCount, err := logins.Count(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "统计不可用")
		return
	}
	operationCount, err := operations.Count(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "统计不可用")
		return
	}
	respond(w, 200, map[string]int{"users": userCount, "activeSessions": active, "loginsToday": loginCount, "operationsToday": operationCount})
}
