package identity

import (
	"context"
	"net/http"

	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
)

type Module struct{ handler *Handler }

func NewModule(handler *Handler) *Module       { return &Module{handler} }
func (*Module) Name() string                   { return "identity" }
func (*Module) Dependencies() []string         { return nil }
func (*Module) Shutdown(context.Context) error { return nil }
func (m *Module) Initialize(_ context.Context, reg *httptransport.Registrar) error {
	for _, op := range []struct {
		id      string
		handler http.HandlerFunc
	}{
		{"apiTokensList", m.handler.ListKeys},
		{"apiTokensCreate", m.handler.CreateKey},
		{"apiTokensRemove", m.handler.RevokeKey},
		{"integrationKeyPermissions", m.handler.KeyPermissions},
		{"authResolveSessionConflict", m.handler.ResolveSessionConflict},
		{"authDeleteOtherSessions", m.handler.DeleteOtherSessions},
		{"authPreferencePolicy", m.handler.PreferencePolicy},
		{"authFavoriteMenus", m.handler.FavoriteMenus},
		{"authFavoriteMenusSave", m.handler.SaveFavoriteMenus},
		{"authPreferences", m.handler.GetPreferences},
		{"authPreferencesUpdate", m.handler.UpdatePreferences},
		{"authMySessions", m.handler.ListSessions},
		{"authChangePassword", m.handler.ChangePassword},
		{"authCaptcha", m.handler.Captcha},
		{"authProfileUpdate", m.handler.UpdateProfile},
		{"authLogout", m.handler.Logout},
		{"authAvatarUpload", m.handler.UploadAvatar},
		{"authLogin", m.handler.Login},
		{"sessionsList", m.handler.OnlineSessions},
		{"authMe", m.handler.Me},
		{"authDeleteSession", m.handler.RevokeSession},
		{"sessionsForceLogoutUser", m.handler.ForceLogout},
		{"sessionsForceLogout", m.handler.ForceLogout},
	} {
		if err := reg.RegisterContract(op.id, op.handler); err != nil {
			return err
		}
	}
	return nil
}
