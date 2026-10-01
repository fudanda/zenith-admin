package files

import (
	"net/http"

	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service} }
func (h *Handler) UploadFiles(w http.ResponseWriter, r *http.Request) {
	limit, err := h.service.UploadLimit(r.Context())
	if err != nil {
		httptransport.WriteOutcome(w, r, kernel.Outcome{}, err)
		return
	}
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+2*(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		httptransport.Fail(w, 400, "invalid_multipart", "上传内容无效")
		return
	}
	input.Files = httptransport.NewUploadSource(reader)
	result, err := h.service.UploadFiles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) BrowseFiles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.BrowseFiles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadInit(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UploadInit(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadChunk(w http.ResponseWriter, r *http.Request) {
	input, cleanup, err := httptransport.ReadMultipart(w, r, (32<<20)+(1<<20))
	if err != nil {
		httptransport.Fail(w, 400, "invalid_multipart", "分片内容无效")
		return
	}
	defer cleanup()
	result, err := h.service.UploadChunk(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadStatus(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UploadStatus(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadComplete(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UploadComplete(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadAbort(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.UploadAbort(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListFileConfigs(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListFileConfigs(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DefaultFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DefaultFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SaveFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SaveFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) SetDefaultFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.SetDefaultFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) TestFileConfig(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.TestFileConfig(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.ListFiles(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) GetFile(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.GetFile(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) UploadOne(w http.ResponseWriter, r *http.Request) {
	limit, err := h.service.UploadLimit(r.Context())
	if err != nil {
		httptransport.WriteOutcome(w, r, kernel.Outcome{}, err)
		return
	}
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1*(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		httptransport.Fail(w, 400, "invalid_multipart", "上传内容无效")
		return
	}
	input.Files = httptransport.NewUploadSource(reader)
	result, err := h.service.UploadOne(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) FileContent(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.FileContent(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) PrivateFileContent(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.PrivateFileContent(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) AccessFileURL(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.AccessFileURL(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteFile(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DeleteFilesBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DeleteFilesBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) DownloadFilesBatch(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.DownloadFilesBatch(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
func (h *Handler) FileStats(w http.ResponseWriter, r *http.Request) {
	input, err := httptransport.ReadInput(w, r)
	if err != nil {
		httptransport.Fail(w, 400, "invalid_request", err.Error())
		return
	}
	result, err := h.service.FileStats(r.Context(), input)
	httptransport.WriteOutcome(w, r, result, err)
}
