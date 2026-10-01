package zenith

import (
	"context"
	"net/http"
	"strconv"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/gorilla/mux"
)

func (f *Framework) loginLogView(ctx context.Context, row *ent.LoginLog) (map[string]any, error) {
	status := "fail"
	if row.Success {
		status = "success"
	}
	var nickname any
	if row.UserID != nil {
		account, err := f.Store.Client.User.Get(ctx, *row.UserID)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
		if account != nil {
			nickname = account.Nickname
		}
	}
	return map[string]any{"id": row.ID, "userId": row.UserID, "username": row.Username, "nickname": nickname, "ip": row.IP, "location": nil, "browser": row.Browser, "os": row.Os, "userAgent": row.UserAgent, "eventType": row.EventType, "status": status, "message": row.Reason, "createdAt": row.CreatedAt}, nil
}
func (f *Framework) auditLogView(ctx context.Context, row *ent.AuditLog) (map[string]any, error) {
	var username, nickname any
	account, err := f.Store.Client.User.Get(ctx, row.ActorID)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if account != nil {
		username = account.Username
		nickname = account.Nickname
	}
	return map[string]any{"id": row.ID, "userId": row.ActorID, "username": username, "nickname": nickname, "module": row.Module, "description": row.Description, "method": row.Method, "path": row.Path, "requestId": row.RequestID, "requestBody": row.RequestBody, "beforeData": nil, "afterData": nil, "responseCode": row.ResponseCode, "responseBody": nil, "durationMs": row.DurationMs, "ip": row.IP, "location": nil, "userAgent": row.UserAgent, "os": row.Os, "browser": row.Browser, "createdAt": row.CreatedAt}, nil
}
func (f *Framework) auditLogDetail(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	row, err := query.Where(auditlog.IDEQ(id)).Only(r.Context())
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "操作记录不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.auditLogView(r.Context(), row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}
func (f *Framework) myLoginLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("userId", strconv.Itoa(fromContext(r.Context()).User.ID))
	r.URL.RawQuery = q.Encode()
	f.listLoginLogs(w, r)
}
func (f *Framework) myOperationLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("userId", strconv.Itoa(fromContext(r.Context()).User.ID))
	r.URL.RawQuery = q.Encode()
	f.listAuditLogs(w, r)
}
