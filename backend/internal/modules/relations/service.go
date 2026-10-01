package relations

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

type Dependencies struct {
	Permits           func(ctx context.Context, inArgs kernel.Input, permission string) (bool, error)
	VisibleUser       func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error)
	FilteredAuditLogs func(ctx context.Context, p *kernel.Principal, q kernel.Values) (*ent.AuditLogQuery, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

func entityRef(kind string, id int) map[string]any {
	return map[string]any{"type": kind, "key": strconv.Itoa(id)}
}

var relationCapabilities = map[string]bool{"view": true, "open": false}

func (f *Service) RelationAnchor(ctx context.Context, inArgs kernel.Input) (string, int, string, error) {
	kind := inArgs.Type
	id, err := kernel.IntParam(inArgs.Key)
	if err != nil {
		return "", 0, "", err
	}
	if kind == "identity.user" {
		allowed, err := f.deps.Permits(ctx, inArgs, "system:user:list")
		if err != nil {
			return "", 0, "", err
		}
		if !allowed {
			return "", 0, "", kernel.ErrUnauthenticated
		}
		account, err := f.deps.VisibleUser(ctx, kernel.FromContext(ctx), id)
		if err != nil {
			return "", 0, "", err
		}
		return kind, id, account.Nickname, nil
	}
	if kind == "platform.operation-log" {
		allowed, err := f.deps.Permits(ctx, inArgs, "system:log:operation")
		if err != nil {
			return "", 0, "", err
		}
		if !allowed {
			return "", 0, "", kernel.ErrUnauthenticated
		}
		query, err := f.deps.FilteredAuditLogs(ctx, kernel.FromContext(ctx), kernel.Values{})
		if err != nil {
			return "", 0, "", err
		}
		row, err := query.Where(auditlog.IDEQ(id)).Only(ctx)
		if err != nil {
			return "", 0, "", err
		}
		title := row.Description
		if title == "" {
			title = row.Operation
		}
		return kind, id, title, nil
	}
	return "", 0, "", &ent.NotFoundError{}
}

func (f *Service) DescribeRelations(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	kind, id, title, err := f.RelationAnchor(ctx, inArgs)
	if err != nil {
		return kernel.Outcome{}, relationError(err)
	}
	sections := []any{}
	if kind == "identity.user" {
		allowed, err := f.deps.Permits(ctx, inArgs, "system:log:operation")
		if err != nil {
			return kernel.Outcome{}, relationError(err)
		}
		if allowed {
			query, err := f.UserAuditRelations(ctx, inArgs, id, kernel.Values{})
			if err != nil {
				return kernel.Outcome{}, relationError(err)
			}
			exists, err := query.Exist(ctx)
			if err != nil {
				return kernel.Outcome{}, relationError(err)
			}
			state := "empty"
			if exists {
				state = "has-data"
			}
			sections = append(sections, map[string]any{"key": "identity.user.audit", "labelKey": "relation.common.audit", "targetTypes": []string{"platform.operation-log"}, "kind": "activity", "cardinality": "many", "capabilities": relationCapabilities, "summaryState": state, "filters": map[string]any{"keyword": true, "dateRange": true}})
		}
	}
	return kernel.Success(200, map[string]any{"anchor": map[string]any{"ref": entityRef(kind, id), "title": title}, "sections": sections, "canManageLinks": false})
}

func (f *Service) UserAuditRelations(ctx context.Context, inArgs kernel.Input, id int, filters kernel.Values) (*ent.AuditLogQuery, error) {
	query, err := f.deps.FilteredAuditLogs(ctx, kernel.FromContext(ctx), filters)
	if err != nil {
		return nil, err
	}
	return query.Where(auditlog.Or(auditlog.ActorIDEQ(id), auditlog.And(auditlog.ResourceEQ("users"), auditlog.ResourceIDEQ(id)))), nil
}

func (f *Service) RelationSection(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	kind, id, _, err := f.RelationAnchor(ctx, inArgs)
	if err != nil {
		return kernel.Outcome{}, relationError(err)
	}
	if kind != "identity.user" || inArgs.SectionKey != "identity.user.audit" {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "关联分组不存在")
	}
	allowed, err := f.deps.Permits(ctx, inArgs, "system:log:operation")
	if err != nil {
		return kernel.Outcome{}, relationError(err)
	}
	if !allowed {
		return kernel.Outcome{}, kernel.Fail(403, "forbidden", "没有日志权限")
	}
	q := inArgs.Filter
	if q.Get("status") != "" || q.Get("attentionOnly") == "true" {
		return kernel.Outcome{}, kernel.Fail(400, "unsupported_filter", "该关联分组不支持此筛选")
	}
	filters := kernel.Values{}
	for _, key := range []string{"startTime", "endTime"} {
		if q.Get(key) != "" {
			filters.Set(key, q.Get(key))
		}
	}
	query, err := f.UserAuditRelations(ctx, inArgs, id, filters)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(auditlog.Or(auditlog.DescriptionContainsFold(keyword), auditlog.ModuleContainsFold(keyword), auditlog.PathContainsFold(keyword)))
	}
	limit, err := kernel.PositiveInt(q.Get("limit"), 5, 50)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_limit", err.Error())
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, relationError(err)
	}
	if cursor := q.Get("cursor"); cursor != "" {
		value, err := kernel.IntParam(cursor)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_cursor", "游标无效")
		}
		query = query.Where(auditlog.IDLT(value))
	}
	rows, err := query.Order(ent.Desc(auditlog.FieldID)).Limit(limit + 1).All(ctx)
	if err != nil {
		return kernel.Outcome{}, relationError(err)
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := []any{}
	for _, row := range rows {
		title := row.Description
		if title == "" {
			title = row.Operation
		}
		items = append(items, map[string]any{"ref": entityRef("platform.operation-log", row.ID), "relationKey": "identity.user.audit", "title": title, "subtitle": fmt.Sprintf("%s %s", row.Method, row.Path), "occurredAt": row.CreatedAt, "capabilities": relationCapabilities, "origin": map[string]any{"kind": "activity", "explanation": "该账号的实际操作或账号维护审计"}})
	}
	var next any
	if hasMore && len(rows) > 0 {
		next = strconv.Itoa(rows[len(rows)-1].ID)
	}
	return kernel.Success(200, map[string]any{"items": items, "total": total, "nextCursor": next, "hasMore": hasMore})
}

func relationError(err error) error {
	if ent.IsNotFound(err) {
		return kernel.Fail(404, "not_found", "关联对象不存在")
	}
	if errors.Is(err, kernel.ErrUnauthenticated) {
		return kernel.Fail(403, "forbidden", "没有对象访问权限")
	}
	return kernel.Fail(503, "database_unavailable", "关联查询失败")
}
