package positions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/security"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
	"github.com/fudanda/zenith-admin/backend/internal/validation"
	"github.com/gorilla/mux"
)

type Handler struct {
	service *Service
	trace   func(context.Context) string
}

func NewHandler(service *Service, trace func(context.Context) string) *Handler {
	return &Handler{service: service, trace: trace}
}

func (h *Handler) actor(r *http.Request) security.Actor {
	return security.Actor{UserID: security.FromContext(r.Context()).User.ID, RequestID: h.trace(r.Context())}
}

func readID(w http.ResponseWriter, r *http.Request) (int, bool) {
	id, err := httptransport.IntParam(mux.Vars(r)["id"])
	if err != nil {
		httptransport.Fail(w, 400, "invalid_id", err.Error())
		return 0, false
	}
	return id, true
}

func readPage(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	page, err := httptransport.PositiveInt(r.URL.Query().Get("page"), 1, 1000000)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_page", err.Error())
		return 0, 0, false
	}
	size, err := httptransport.PositiveInt(r.URL.Query().Get("pageSize"), 10, 200)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_page_size", err.Error())
		return 0, 0, false
	}
	return page, size, true
}

func readFilter(w http.ResponseWriter, r *http.Request) (Filter, bool) {
	q := r.URL.Query()
	filter := Filter{Keyword: q.Get("keyword"), Status: q.Get("status")}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				httptransport.Fail(w, 400, "invalid_date_range", err.Error())
				return filter, false
			}
			if bound.end {
				filter.End = &value
			} else {
				filter.Start = &value
			}
		}
	}
	return filter, true
}

func inputFailure(w http.ResponseWriter, err error) bool {
	var invalid *InputError
	if errors.As(err, &invalid) {
		httptransport.Fail(w, 400, invalid.Code, invalid.Message)
		return true
	}
	return false
}

func queryFailure(w http.ResponseWriter, err error) {
	if IsNotFound(err) {
		httptransport.Fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if !inputFailure(w, err) {
		httptransport.Fail(w, 503, "database_unavailable", "查询失败")
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	page, size, ok := readPage(w, r)
	if !ok {
		return
	}
	filter, ok := readFilter(w, r)
	if !ok {
		return
	}
	result, err := h.service.List(r.Context(), security.FromContext(r.Context()), filter, page, size)
	if err != nil {
		queryFailure(w, err)
		return
	}
	httptransport.Respond(w, 200, result)
}

func (h *Handler) All(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.All(r.Context(), security.FromContext(r.Context()))
	if err != nil {
		queryFailure(w, err)
		return
	}
	httptransport.Respond(w, 200, result)
}

func (h *Handler) Detail(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	result, err := h.service.Detail(r.Context(), security.FromContext(r.Context()), id)
	if err != nil {
		queryFailure(w, err)
		return
	}
	httptransport.Respond(w, 200, result)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body contracts.PositionsCreateJSONBody
	if err := httptransport.Decode(r, &body); err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	in := Input{Name: body.Name, Code: body.Code, Remark: body.Remark, Status: "enabled"}
	if body.Sort != nil {
		in.Sort = *body.Sort
	}
	if body.Status != nil {
		in.Status = string(*body.Status)
	}
	result, err := h.service.Create(r.Context(), h.actor(r), in)
	if err != nil {
		if !inputFailure(w, err) {
			httptransport.Fail(w, 409, "position_conflict", "岗位保存失败，请检查编码是否重复")
		}
		return
	}
	httptransport.Respond(w, 201, result)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	var patch map[string]json.RawMessage
	if err := httptransport.Decode(r, &patch); err != nil || len(patch) == 0 {
		httptransport.Fail(w, 400, "invalid_request", "更新内容不能为空")
		return
	}
	for key := range patch {
		if key != "name" && key != "code" && key != "sort" && key != "status" && key != "remark" {
			httptransport.Fail(w, 400, "invalid_request", "未知字段")
			return
		}
	}
	result, err := h.service.Update(r.Context(), security.FromContext(r.Context()), h.actor(r), id, patch)
	var queryErr *QueryError
	if errors.As(err, &queryErr) {
		httptransport.Fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if IsNotFound(err) {
		httptransport.Fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if err != nil {
		httptransport.Fail(w, 409, "position_conflict", err.Error())
		return
	}
	httptransport.Respond(w, 200, result)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	err := h.service.Delete(r.Context(), security.FromContext(r.Context()), h.actor(r), id)
	if IsNotFound(err) {
		httptransport.Fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if err != nil {
		httptransport.Fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	httptransport.Respond(w, 200, nil)
}

func (h *Handler) DeleteBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := httptransport.Decode(r, &body); err != nil {
		httptransport.Fail(w, 400, "invalid_ids", "请选择 1 到 200 个岗位")
		return
	}
	err := h.service.DeleteBatch(r.Context(), security.FromContext(r.Context()), h.actor(r), body.IDs)
	if inputFailure(w, err) {
		return
	}
	if IsNotFound(err) {
		httptransport.Fail(w, 404, "not_found", "岗位不存在或不可访问")
		return
	}
	if err != nil {
		httptransport.Fail(w, 503, "database_unavailable", "批量删除失败")
		return
	}
	httptransport.Respond(w, 200, nil)
}

func (h *Handler) Members(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	result, err := h.service.Members(r.Context(), security.FromContext(r.Context()), id, "")
	if err != nil {
		queryFailure(w, err)
		return
	}
	httptransport.Respond(w, 200, result)
}

func (h *Handler) MemberPreview(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	page, size, ok := readPage(w, r)
	if !ok {
		return
	}
	rows, err := h.service.Members(r.Context(), security.FromContext(r.Context()), id, r.URL.Query().Get("keyword"))
	if err != nil {
		queryFailure(w, err)
		return
	}
	start := min((page-1)*size, len(rows))
	end := min(start+size, len(rows))
	httptransport.Respond(w, 200, map[string]any{"list": rows[start:end], "total": len(rows), "page": page, "pageSize": size})
}

func (h *Handler) SetMembers(w http.ResponseWriter, r *http.Request) {
	id, ok := readID(w, r)
	if !ok {
		return
	}
	var body struct {
		UserIDs []int `json:"userIds"`
	}
	if err := httptransport.Decode(r, &body); err != nil {
		httptransport.Fail(w, 400, "invalid_request", "成员列表无效")
		return
	}
	err := h.service.SetMembers(r.Context(), security.FromContext(r.Context()), h.actor(r), id, body.UserIDs)
	var queryErr *QueryError
	if errors.As(err, &queryErr) {
		httptransport.Fail(w, 503, "database_unavailable", "数据权限查询失败")
		return
	}
	if inputFailure(w, err) {
		return
	}
	if IsNotFound(err) {
		httptransport.Fail(w, 404, "not_found", "岗位或用户不存在")
		return
	}
	if err != nil {
		httptransport.Fail(w, 400, "invalid_members", err.Error())
		return
	}
	httptransport.Respond(w, 200, nil)
}

func (h *Handler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	filter, ok := readFilter(w, r)
	if !ok {
		return
	}
	if filter.Status != "" && filter.Status != "enabled" && filter.Status != "disabled" {
		httptransport.Fail(w, 400, "invalid_status", "状态无效")
		return
	}
	httptransport.StreamCSV(w, "positions.csv", []string{"ID", "岗位名称", "岗位编码", "排序", "状态", "备注", "创建时间"}, func(offset int) ([][]string, error) {
		return h.service.ExportBatch(r.Context(), filter, offset, 200)
	})
}
