package relations

import (
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) DescribeRelations(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DescribeRelations(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) RelationSection(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.RelationSection(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
