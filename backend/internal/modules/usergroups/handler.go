package usergroups

import (
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) PreviewGroupRule(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.PreviewGroupRule(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SyncGroup(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SyncGroup(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GroupMemberPreview(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GroupMemberPreview(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ChangeGroupMembers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ChangeGroupMembers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteGroupsBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteGroupsBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListGroups(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AllGroups(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AllGroups(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetGroup(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetGroup(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveGroup(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveGroup(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteGroup(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GroupMembers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GroupMembers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SetGroupMembers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SetGroupMembers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GroupRoles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GroupRoles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SetGroupRoles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SetGroupRoles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
