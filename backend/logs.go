package zenith

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
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

func (f *Framework) filteredLoginLogs(p *principal, q url.Values) (*ent.LoginLogQuery, error) {
	if err := validateLogFilters(q, "userId", "username", "eventType", "status", "startTime", "endTime"); err != nil {
		return nil, err
	}
	query := f.Store.Client.LoginLog.Query()
	if p.TenantID != nil {
		query = query.Where(loginlog.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		query = query.Where(loginlog.TenantIDIsNil())
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
		case "login":
		case "logout", "impersonate", "impersonate_end", "kicked":
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

func (f *Framework) filteredAuditLogs(p *principal, q url.Values) (*ent.AuditLogQuery, error) {
	if err := validateLogFilters(q, "userId", "module", "description", "startTime", "endTime", "resource"); err != nil {
		return nil, err
	}
	query := f.Store.Client.AuditLog.Query()
	if p.TenantID != nil {
		query = query.Where(auditlog.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		query = query.Where(auditlog.TenantIDIsNil())
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
		query = query.Where(auditlog.ResourceContainsFold(resource))
	}
	if operation := strings.TrimSpace(q.Get("description")); operation != "" {
		query = query.Where(auditlog.OperationContainsFold(operation))
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
	query, err := f.filteredLoginLogs(fromContext(r.Context()), r.URL.Query())
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
		status := "fail"
		if row.Success {
			status = "success"
		}
		list = append(list, map[string]any{"id": row.ID, "userId": row.UserID, "username": row.Username, "ip": row.IP, "eventType": "login", "status": status, "message": row.Reason, "tenantId": row.TenantID, "createdAt": row.CreatedAt})
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	page, size, err := logPage(r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	query, err := f.filteredAuditLogs(fromContext(r.Context()), r.URL.Query())
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
		list = append(list, map[string]any{"id": row.ID, "actorId": row.ActorID, "tenantId": row.TenantID, "operation": row.Operation, "resource": row.Resource, "resourceId": row.ResourceID, "requestId": row.RequestID, "createdAt": row.CreatedAt})
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) exportLoginLogsCSV(w http.ResponseWriter, r *http.Request) {
	query, err := f.filteredLoginLogs(fromContext(r.Context()), r.URL.Query())
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
	query, err := f.filteredAuditLogs(fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	query.Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID))
	streamCSV(w, "operation-logs.csv", []string{"ID", "操作人ID", "租户ID", "操作", "资源", "资源ID", "请求ID", "时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(r.Context())
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			tenant, resourceID := "", ""
			if row.TenantID != nil {
				tenant = strconv.Itoa(*row.TenantID)
			}
			if row.ResourceID != nil {
				resourceID = strconv.Itoa(*row.ResourceID)
			}
			result = append(result, []string{strconv.Itoa(row.ID), strconv.Itoa(row.ActorID), tenant, row.Operation, row.Resource, resourceID, row.RequestID, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}
