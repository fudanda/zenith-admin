package authorization

import (
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) UserEffectivePermissions(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UserEffectivePermissions(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UserMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UserMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetMenu(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetMenu(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveMenu(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveMenu(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteMenu(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteMenu(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) RoleMemberPreview(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.RoleMemberPreview(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListRoles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListRoles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ExportRolesCSV(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ExportRolesCSV(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AllRoles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AllRoles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetRole(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetRole(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveRole(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveRole(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteRole(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) RoleUsers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.RoleUsers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AssignRoleUsers(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AssignRoleUsers(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AssignRoleMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AssignRoleMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetUserMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetUserMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AssignUserMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AssignUserMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AssignUserRoles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AssignUserRoles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetUserDataPermission(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetUserDataPermission(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UpdateUserDataPermission(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UpdateUserDataPermission(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
