package zenith

import (
	"net/http"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
)

func (f *Framework) listLoginLogs(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	q := r.URL.Query()
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	query := f.Store.Client.LoginLog.Query()
	if p.TenantID != nil {
		query = query.Where(loginlog.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		query = query.Where(loginlog.TenantIDIsNil())
	}
	if username := strings.TrimSpace(q.Get("username")); username != "" {
		query = query.Where(loginlog.UsernameContainsFold(username))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(loginlog.FieldCreatedAt)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, map[string]any{
			"id": row.ID, "userId": row.UserID, "username": row.Username, "ip": row.IP,
			"status": map[bool]string{true: "success", false: "fail"}[row.Success], "message": row.Reason,
			"tenantId": row.TenantID, "createdAt": row.CreatedAt,
		})
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	q := r.URL.Query()
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	query := f.Store.Client.AuditLog.Query()
	if p.TenantID != nil {
		query = query.Where(auditlog.TenantIDEQ(*p.TenantID))
	} else if !p.SuperAdmin {
		query = query.Where(auditlog.TenantIDIsNil())
	}
	if resource := strings.TrimSpace(q.Get("resource")); resource != "" {
		query = query.Where(auditlog.ResourceEQ(resource))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(auditlog.FieldCreatedAt)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, map[string]any{
			"id": row.ID, "actorId": row.ActorID, "tenantId": row.TenantID, "operation": row.Operation,
			"resource": row.Resource, "resourceId": row.ResourceID, "requestId": row.RequestID, "createdAt": row.CreatedAt,
		})
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}
