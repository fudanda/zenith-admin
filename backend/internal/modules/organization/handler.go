package organization

import (
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) FlatDepartments(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.FlatDepartments(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ExportDepartmentsCSV(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ExportDepartmentsCSV(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) TreeDepartments(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.TreeDepartments(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetDepartment(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetDepartment(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveDepartment(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveDepartment(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteDepartment(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteDepartment(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DepartmentMemberPreview(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DepartmentMemberPreview(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AllUsers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AllUsers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListUsers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetUser(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveUser(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveUser(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ResetUserPassword(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteUser(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteUsersBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteUsersBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UpdateUsersStatusBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UpdateUsersStatusBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ExportUsersCSV(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ExportUsersCSV(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ResetUsersPasswordBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ResetUsersPasswordBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UnlockUser(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UnlockUser(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
