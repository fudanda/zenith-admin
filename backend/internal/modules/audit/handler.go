package audit

import (
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) LoginStats(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.LoginStats(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AuditStats(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AuditStats(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) CleanLoginLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.CleanLoginLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) CleanAuditLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.CleanAuditLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AuditLogDetail(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AuditLogDetail(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) MyLoginLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.MyLoginLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) MyOperationLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.MyOperationLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListLoginLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListLoginLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListAuditLogs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ExportLoginLogsCSV(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ExportLoginLogsCSV(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ExportAuditLogsCSV(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ExportAuditLogsCSV(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
