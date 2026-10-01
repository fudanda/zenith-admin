package system

import (
	"context"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

type Dependencies struct {
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

func (f *Service) Ready(ctx context.Context, input kernel.Input) (kernel.Outcome, error) {
	if _, err := f.Health(ctx, input); err != nil {
		return kernel.Outcome{}, err
	}
	return kernel.Success(200, map[string]string{"status": "ready"})
}

func (f *Service) Health(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if f.Store == nil || f.Store.DB == nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据库未就绪")
	}
	if err := f.Store.DB.PingContext(ctx); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据库未就绪")
	}
	return kernel.Success(200, map[string]string{"status": "ok"})
}

func (f *Service) DashboardStats(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	users := f.Store.Client.User.Query()

	userIDs, err := users.Clone().IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计不可用")
	}
	userCount := len(userIDs)
	active := 0
	onlineUsers := 0
	if len(userIDs) > 0 {
		active, err = f.Store.Client.Session.Query().Where(session.UserIDIn(userIDs...), session.ExpiresAtGT(time.Now()), session.RevokedAtIsNil()).Count(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计不可用")
		}
		ids, e := f.Store.Client.Session.Query().Where(session.UserIDIn(userIDs...), session.ExpiresAtGT(time.Now()), session.RevokedAtIsNil()).Select(session.FieldUserID).Ints(ctx)
		if e != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计不可用")
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
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计不可用")
	}
	operationCount, err := operations.Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计不可用")
	}
	return kernel.Success(200, map[string]int{"totalUsers": userCount, "onlineUsers": onlineUsers, "activeSessions": active, "todayLogins": loginCount, "todayOperations": operationCount})
}
