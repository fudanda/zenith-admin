package zenith

import (
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/session"
)

func (f *Framework) dashboardStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	users := f.Store.Client.User.Query()

	userIDs, err := users.Clone().IDs(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "统计不可用")
		return
	}
	userCount := len(userIDs)
	active := 0
	onlineUsers := 0
	if len(userIDs) > 0 {
		active, err = f.Store.Client.Session.Query().Where(session.UserIDIn(userIDs...), session.ExpiresAtGT(time.Now()), session.RevokedAtIsNil()).Count(ctx)
		if err != nil {
			fail(w, 503, "database_unavailable", "统计不可用")
			return
		}
		ids, e := f.Store.Client.Session.Query().Where(session.UserIDIn(userIDs...), session.ExpiresAtGT(time.Now()), session.RevokedAtIsNil()).Select(session.FieldUserID).Ints(ctx)
		if e != nil {
			fail(w, 503, "database_unavailable", "统计不可用")
			return
		}
		distinct := map[int]bool{}
		for _, id := range ids {
			distinct[id] = true
		}
		onlineUsers = len(distinct)
	}
	now := time.Now()
	year, month, day := now.Date()
	start := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	logins := f.Store.Client.LoginLog.Query().Where(loginlog.CreatedAtGTE(start), loginlog.SuccessEQ(true))
	operations := f.Store.Client.AuditLog.Query().Where(auditlog.CreatedAtGTE(start))

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
	respond(w, 200, map[string]int{"totalUsers": userCount, "onlineUsers": onlineUsers, "activeSessions": active, "todayLogins": loginCount, "todayOperations": operationCount})
}
