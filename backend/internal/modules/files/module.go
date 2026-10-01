package files

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "files" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"fileConfigsDefaultConfig", m.handler.DefaultFileConfig},
		{"fileConfigsTest", m.handler.TestFileConfig},
		{"filesUploadComplete", m.handler.UploadComplete},
		{"filesBatchDownload", m.handler.DownloadFilesBatch},
		{"fileConfigsList", m.handler.ListFileConfigs},
		{"fileConfigsCreate", m.handler.SaveFileConfig},
		{"filesUploadChunk", m.handler.UploadChunk},
		{"filesUploadInit", m.handler.UploadInit},
		{"filesUploadOne", m.handler.UploadOne},
		{"filesBrowse", m.handler.BrowseFiles},
		{"filesUpload", m.handler.UploadFiles},
		{"filesRemoveBatch", m.handler.DeleteFilesBatch},
		{"filesStats", m.handler.FileStats},
		{"filesList", m.handler.ListFiles},
		{"fileConfigsSetDefault", m.handler.SetDefaultFileConfig},
		{"filesUploadStatus", m.handler.UploadStatus},
		{"fileConfigsTestExisting", m.handler.TestFileConfig},
		{"filesPrivateContent", m.handler.PrivateFileContent},
		{"fileConfigsDetail", m.handler.GetFileConfig},
		{"fileConfigsUpdate", m.handler.SaveFileConfig},
		{"fileConfigsRemove", m.handler.DeleteFileConfig},
		{"filesUploadAbort", m.handler.UploadAbort},
		{"filesAccessUrl", m.handler.AccessFileURL},
		{"filesContent", m.handler.FileContent},
		{"filesDetail", m.handler.GetFile},
		{"filesRemove", m.handler.DeleteFile},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
