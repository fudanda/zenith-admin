package zenith

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/gorilla/mux"
)

func entityRef(kind string, id int) map[string]any {
	return map[string]any{"type": kind, "key": strconv.Itoa(id)}
}

var relationCapabilities = map[string]bool{"view": true, "open": false}

func (f *Framework) relationAnchor(r *http.Request) (string, int, string, error) {
	kind := mux.Vars(r)["type"]
	id, err := intParam(mux.Vars(r)["key"])
	if err != nil {
		return "", 0, "", err
	}
	if kind == "identity.user" {
		allowed, err := f.permits(r, "system:user:list")
		if err != nil {
			return "", 0, "", err
		}
		if !allowed {
			return "", 0, "", errUnauthenticated
		}
		account, err := f.visibleUser(r.Context(), fromContext(r.Context()), id)
		if err != nil {
			return "", 0, "", err
		}
		return kind, id, account.Nickname, nil
	}
	if kind == "platform.operation-log" {
		allowed, err := f.permits(r, "system:log:operation")
		if err != nil {
			return "", 0, "", err
		}
		if !allowed {
			return "", 0, "", errUnauthenticated
		}
		query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), url.Values{})
		if err != nil {
			return "", 0, "", err
		}
		row, err := query.Where(auditlog.IDEQ(id)).Only(r.Context())
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
func (f *Framework) describeRelations(w http.ResponseWriter, r *http.Request) {
	kind, id, title, err := f.relationAnchor(r)
	if err != nil {
		f.relationError(w, err)
		return
	}
	sections := []any{}
	if kind == "identity.user" {
		allowed, err := f.permits(r, "system:log:operation")
		if err != nil {
			f.relationError(w, err)
			return
		}
		if allowed {
			query, err := f.userAuditRelations(r, id, url.Values{})
			if err != nil {
				f.relationError(w, err)
				return
			}
			exists, err := query.Exist(r.Context())
			if err != nil {
				f.relationError(w, err)
				return
			}
			state := "empty"
			if exists {
				state = "has-data"
			}
			sections = append(sections, map[string]any{"key": "identity.user.audit", "labelKey": "relation.common.audit", "targetTypes": []string{"platform.operation-log"}, "kind": "activity", "cardinality": "many", "capabilities": relationCapabilities, "summaryState": state, "filters": map[string]any{"keyword": true, "dateRange": true}})
		}
	}
	respond(w, 200, map[string]any{"anchor": map[string]any{"ref": entityRef(kind, id), "title": title}, "sections": sections, "canManageLinks": false})
}
func (f *Framework) userAuditRelations(r *http.Request, id int, filters url.Values) (*ent.AuditLogQuery, error) {
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), filters)
	if err != nil {
		return nil, err
	}
	return query.Where(auditlog.Or(auditlog.ActorIDEQ(id), auditlog.And(auditlog.ResourceEQ("users"), auditlog.ResourceIDEQ(id)))), nil
}
func (f *Framework) relationSection(w http.ResponseWriter, r *http.Request) {
	kind, id, _, err := f.relationAnchor(r)
	if err != nil {
		f.relationError(w, err)
		return
	}
	if kind != "identity.user" || mux.Vars(r)["sectionKey"] != "identity.user.audit" {
		fail(w, 404, "not_found", "关联分组不存在")
		return
	}
	allowed, err := f.permits(r, "system:log:operation")
	if err != nil {
		f.relationError(w, err)
		return
	}
	if !allowed {
		fail(w, 403, "forbidden", "没有日志权限")
		return
	}
	q := r.URL.Query()
	if q.Get("status") != "" || q.Get("attentionOnly") == "true" {
		fail(w, 400, "unsupported_filter", "该关联分组不支持此筛选")
		return
	}
	filters := url.Values{}
	for _, key := range []string{"startTime", "endTime"} {
		if q.Get(key) != "" {
			filters.Set(key, q.Get(key))
		}
	}
	query, err := f.userAuditRelations(r, id, filters)
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(auditlog.Or(auditlog.DescriptionContainsFold(keyword), auditlog.ModuleContainsFold(keyword), auditlog.PathContainsFold(keyword)))
	}
	limit, err := positiveInt(q.Get("limit"), 5, 50)
	if err != nil {
		fail(w, 400, "invalid_limit", err.Error())
		return
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		f.relationError(w, err)
		return
	}
	if cursor := q.Get("cursor"); cursor != "" {
		value, err := intParam(cursor)
		if err != nil {
			fail(w, 400, "invalid_cursor", "游标无效")
			return
		}
		query = query.Where(auditlog.IDLT(value))
	}
	rows, err := query.Order(ent.Desc(auditlog.FieldID)).Limit(limit + 1).All(r.Context())
	if err != nil {
		f.relationError(w, err)
		return
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
	respond(w, 200, map[string]any{"items": items, "total": total, "nextCursor": next, "hasMore": hasMore})
}
func (f *Framework) relationError(w http.ResponseWriter, err error) {
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "关联对象不存在")
		return
	}
	if errors.Is(err, errUnauthenticated) {
		fail(w, 403, "forbidden", "没有对象访问权限")
		return
	}
	fail(w, 503, "database_unavailable", "关联查询失败")
}
