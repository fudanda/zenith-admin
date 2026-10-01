package identity

import (
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UpdateProfile(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UpdatePreferences(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetPreferences(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) PreferencePolicy(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.PreferencePolicy(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) FavoriteMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.FavoriteMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveFavoriteMenus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveFavoriteMenus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ChangePassword(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListSessions(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.RevokeSession(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteOtherSessions(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteOtherSessions(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) Captcha(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.Captcha(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.Login(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.Me(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.Logout(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	input, cleanup, err := httptransport.ReadMultipart(w, r, 3<<20)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_upload", "请选择有效头像")
		return
	}
	defer cleanup()
	result, err := h.service.UploadAvatar(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ResolveSessionConflict(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ResolveSessionConflict(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) OnlineSessions(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.OnlineSessions(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ForceLogout(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ForceLogout(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) ListKeys(w http.ResponseWriter, r *http.Request) {
	in, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListKeys(r.Context(), in)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) CreateKey(w http.ResponseWriter, r *http.Request) {
	in, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.CreateKey(r.Context(), in)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	in, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.RevokeKey(r.Context(), in)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) KeyPermissions(w http.ResponseWriter, r *http.Request) {
	in, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.KeyPermissions(r.Context(), in)
	httptransport.WriteOutcome(w, r, result, err)
}
