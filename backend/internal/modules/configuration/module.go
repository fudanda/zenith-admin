package configuration

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "configuration" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"settingsGetIdentitySecurity", m.handler.GetRuntimeSetting},
		{"settingsUpdateIdentitySecurity", m.handler.UpdateRuntimeSetting},
		{"filesUploadPolicy", m.handler.FileUploadPolicy},
		{"settingsPublic", m.handler.SettingsProjection},
		{"settingsGetFiles", m.handler.GetFileSettings},
		{"settingsUpdateFiles", m.handler.UpdateFileSettings},
		{"settingsGetAuth", m.handler.GetRuntimeSetting},
		{"settingsUpdateAuth", m.handler.UpdateRuntimeSetting},
		{"dictsExportCsv", m.handler.ExportDictsCSV},
		{"settingsMe", m.handler.SettingsProjection},
		{"settingsGetUi", m.handler.GetRuntimeSetting},
		{"settingsUpdateUi", m.handler.UpdateRuntimeSetting},
		{"settingsList", m.handler.RuntimeSettingsList},
		{"dictsList", m.handler.ListDicts},
		{"dictsCreate", m.handler.SaveDict},
		{"dictsItemsByCode", m.handler.ListDictItemsByCode},
		{"dictsItems", m.handler.ListDictItems},
		{"dictsCreateItem", m.handler.SaveDictItem},
		{"dictsDetail", m.handler.GetDict},
		{"dictsUpdate", m.handler.SaveDict},
		{"dictsRemove", m.handler.DeleteDict},
		{"dictsItemDetail", m.handler.GetDictItem},
		{"dictsUpdateItem", m.handler.SaveDictItem},
		{"dictsRemoveItem", m.handler.DeleteDictItem},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
