package transfers

import (
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
	"github.com/gorilla/mux"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }

func (h *Handler) UserImportTemplate(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UserImportTemplate(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SyncUserImport(w http.ResponseWriter, r *http.Request) {
	input, cleanup, err := httptransport.ReadMultipart(w, r, 10<<20)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_upload", "请上传不超过 10 MB 的 XLSX 文件")
		return
	}
	defer cleanup()
	result, err := h.service.SyncUserImport(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}

func (h *Handler) SyncExport(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	source, ok := Sources[input.Entity]
	if !ok {
		httptransport.Fail(w, 404, "not_found", "导出对象不存在")
		return
	}
	request := r.Clone(r.Context())
	copied := *r.URL
	request.URL = &copied
	q := r.URL.Query()
	q.Del("format")
	request.URL.RawQuery = q.Encode()
	request = mux.SetURLVars(request, nil)
	if err = httptransport.ValidateContractRequest(request, source.Operation); err != nil {
		httptransport.Fail(w, 400, "invalid_filter", err.Error())
		return
	}
	result, err := h.service.SyncExport(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
