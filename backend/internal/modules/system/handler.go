package system

import (
	"net/http"

	"github.com/fudanda/arcbase/backend/internal/kernel"
	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Ready(r.Context(), kernel.Input{})
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.Health(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DashboardStats(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DashboardStats(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
