package zenith

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/user"
)

func logBounds(q url.Values) (*time.Time, *time.Time, error) {
	var start, end *time.Time
	if raw := q.Get("startTime"); raw != "" {
		v, err := parseFilterDateBound(raw, false)
		if err != nil {
			return nil, nil, err
		}
		start = &v
	}
	if raw := q.Get("endTime"); raw != "" {
		v, err := parseFilterDateBound(raw, true)
		if err != nil {
			return nil, nil, err
		}
		end = &v
	}
	if start != nil && end != nil && start.After(*end) {
		return nil, nil, errors.New("结束时间不能早于开始时间")
	}
	return start, end, nil
}

func logUserID(q url.Values) (int, error) {
	if q.Get("userId") == "" {
		return 0, nil
	}
	return positiveInt(q.Get("userId"), 0, 2147483647)
}

func validateLogFilters(q url.Values, keys ...string) error {
	allowed := map[string]bool{"page": true, "pageSize": true}
	for _, key := range keys {
		allowed[key] = true
	}
	for key, values := range q {
		if allowed[key] {
			continue
		}
		for _, value := range values {
			if value != "" {
				return errors.New("不支持的筛选字段: " + key)
			}
		}
	}
	return nil
}

func (f *Framework) filteredLoginLogs(ctx context.Context, p *principal, q url.Values) (*ent.LoginLogQuery, error) {
	if err := validateLogFilters(q, "userId", "username", "eventType", "status", "startTime", "endTime", "format"); err != nil {
		return nil, err
	}
	query := f.Store.Client.LoginLog.Query()
	if !p.SuperAdmin {
		scope, err := f.userDataPredicate(ctx, p)
		if err != nil {
			return nil, err
		}
		if scope != nil {
			ids, err := f.Store.Client.User.Query().Where(scope).IDs(ctx)
			if err != nil {
				return nil, err
			}
			query = query.Where(loginlog.UserIDIn(ids...))
		}
	}

	id, err := logUserID(q)
	if err != nil {
		return nil, err
	}
	if id > 0 {
		query = query.Where(loginlog.UserIDEQ(id))
	}
	if username := strings.TrimSpace(q.Get("username")); username != "" {
		query = query.Where(loginlog.UsernameContainsFold(username))
	}
	if event := q.Get("eventType"); event != "" {
		switch event {
		case "login", "logout", "kicked":
			query = query.Where(loginlog.EventTypeEQ(event))
		case "impersonate", "impersonate_end":
			query = query.Where(loginlog.IDEQ(0))
		default:
			return nil, errors.New("事件类型无效")
		}
	}
	if status := q.Get("status"); status != "" {
		if status != "success" && status != "fail" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(loginlog.SuccessEQ(status == "success"))
	}
	start, end, err := logBounds(q)
	if err != nil {
		return nil, err
	}
	if start != nil {
		query = query.Where(loginlog.CreatedAtGTE(*start))
	}
	if end != nil {
		query = query.Where(loginlog.CreatedAtLTE(*end))
	}
	return query, nil
}

func (f *Framework) filteredAuditLogs(ctx context.Context, p *principal, q url.Values) (*ent.AuditLogQuery, error) {
	if err := validateLogFilters(q, "userId", "module", "description", "startTime", "endTime", "resource", "username", "method", "path", "ip", "status", "content", "impersonated", "minDurationMs", "maxDurationMs", "format"); err != nil {
		return nil, err
	}
	query := f.Store.Client.AuditLog.Query()
	if !p.SuperAdmin {
		scope, err := f.userDataPredicate(ctx, p)
		if err != nil {
			return nil, err
		}
		if scope != nil {
			ids, err := f.Store.Client.User.Query().Where(scope).IDs(ctx)
			if err != nil {
				return nil, err
			}
			query = query.Where(auditlog.ActorIDIn(ids...))
		}
	}

	id, err := logUserID(q)
	if err != nil {
		return nil, err
	}
	if id > 0 {
		query = query.Where(auditlog.ActorIDEQ(id))
	}
	resource := strings.TrimSpace(q.Get("module"))
	if resource == "" {
		resource = strings.TrimSpace(q.Get("resource"))
	}
	if resource != "" {
		query = query.Where(auditlog.Or(auditlog.ModuleContainsFold(resource), auditlog.ResourceContainsFold(resource)))
	}
	if operation := strings.TrimSpace(q.Get("description")); operation != "" {
		query = query.Where(auditlog.Or(auditlog.DescriptionContainsFold(operation), auditlog.OperationContainsFold(operation)))
	}
	if keyword := strings.TrimSpace(q.Get("username")); keyword != "" {
		ids, err := f.Store.Client.User.Query().Where(user.Or(user.UsernameContainsFold(keyword), user.NicknameContainsFold(keyword))).IDs(ctx)
		if err != nil {
			return nil, err
		}
		query = query.Where(auditlog.ActorIDIn(ids...))
	}
	for _, filter := range []struct {
		key       string
		predicate func(string) predicate.AuditLog
	}{{"method", auditlog.MethodContainsFold}, {"path", auditlog.PathContainsFold}, {"ip", auditlog.IPContainsFold}, {"content", auditlog.RequestBodyContainsFold}} {
		if value := q.Get(filter.key); value != "" {
			query = query.Where(filter.predicate(value))
		}
	}
	if status := q.Get("status"); status != "" {
		if status == "success" {
			query = query.Where(auditlog.ResponseCodeLT(400))
		} else if status == "fail" {
			query = query.Where(auditlog.ResponseCodeGTE(400))
		} else {
			return nil, errors.New("结果状态无效")
		}
	}
	if value := q.Get("impersonated"); value != "" && value != "false" && value != "0" {
		if value == "true" || value == "1" {
			query = query.Where(auditlog.IDEQ(0))
		} else {
			return nil, errors.New("模拟操作筛选无效")
		}
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"minDurationMs", false}, {"maxDurationMs", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 0 {
				return nil, errors.New("耗时筛选无效")
			}
			if bound.end {
				query = query.Where(auditlog.DurationMsLTE(value))
			} else {
				query = query.Where(auditlog.DurationMsGTE(value))
			}
		}
	}
	start, end, err := logBounds(q)
	if err != nil {
		return nil, err
	}
	if start != nil {
		query = query.Where(auditlog.CreatedAtGTE(*start))
	}
	if end != nil {
		query = query.Where(auditlog.CreatedAtLTE(*end))
	}
	return query, nil
}

func logPage(q url.Values) (int, int, error) {
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		return 0, 0, err
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	return page, size, err
}

func (f *Framework) listLoginLogs(w http.ResponseWriter, r *http.Request) {
	page, size, err := logPage(r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	query, err := f.filteredLoginLogs(r.Context(), fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(loginlog.FieldCreatedAt), ent.Desc(loginlog.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.loginLogView(r.Context(), row)
		if err != nil {
			fail(w, 503, "database_unavailable", "用户资料查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	page, size, err := logPage(r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.auditLogView(r.Context(), row)
		if err != nil {
			fail(w, 503, "database_unavailable", "用户资料查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) exportLoginLogsCSV(w http.ResponseWriter, r *http.Request) {
	query, err := f.filteredLoginLogs(r.Context(), fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	query.Order(ent.Desc(loginlog.FieldCreatedAt), ent.Desc(loginlog.FieldID))
	streamCSV(w, "login-logs.csv", []string{"ID", "用户ID", "用户名", "事件类型", "IP", "状态", "说明", "时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(r.Context())
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			id := ""
			if row.UserID != nil {
				id = strconv.Itoa(*row.UserID)
			}
			status := "fail"
			if row.Success {
				status = "success"
			}
			result = append(result, []string{strconv.Itoa(row.ID), id, row.Username, "login", row.IP, status, row.Reason, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}

func (f *Framework) exportAuditLogsCSV(w http.ResponseWriter, r *http.Request) {
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	query.Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID))
	streamCSV(w, "operation-logs.csv", []string{"ID", "操作人ID", "操作", "资源", "资源ID", "请求ID", "时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(r.Context())
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			resourceID := ""

			if row.ResourceID != nil {
				resourceID = strconv.Itoa(*row.ResourceID)
			}
			result = append(result, []string{strconv.Itoa(row.ID), strconv.Itoa(row.ActorID), row.Operation, row.Resource, resourceID, row.RequestID, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}
