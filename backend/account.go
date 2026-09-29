package zenith

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

func (f *Framework) updateProfile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Nickname string  `json:"nickname"`
		Email    *string `json:"email"`
	}
	if err := decode(r, &input); err != nil || len([]rune(strings.TrimSpace(input.Nickname))) == 0 || len([]rune(input.Nickname)) > 32 {
		fail(w, 400, "invalid_profile", "个人资料无效")
		return
	}
	p := fromContext(r.Context())
	var result *ent.User
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		update := tx.User.UpdateOneID(p.User.ID).SetNickname(input.Nickname)
		if input.Email == nil {
			update.ClearEmail()
		} else {
			update.SetEmail(*input.Email)
		}
		var err error
		result, err = update.Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("update_profile").SetResource("users").SetResourceID(p.User.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	respond(w, 200, publicUser(result))
}

func (f *Framework) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var input map[string]json.RawMessage
	if err := decode(r, &input); err != nil || len(input) > 32 {
		fail(w, 400, "invalid_preferences", "个人偏好无效")
		return
	}
	allowed := map[string]bool{"theme": true, "language": true, "density": true, "sidebarCollapsed": true}
	for key := range input {
		if !allowed[key] {
			fail(w, 400, "invalid_preferences", "不支持的偏好项")
			return
		}
	}
	p := fromContext(r.Context())
	preferences := map[string]any{}
	for key, value := range input {
		var parsed any
		if err := json.Unmarshal(value, &parsed); err != nil {
			fail(w, 400, "invalid_preferences", "偏好项格式无效")
			return
		}
		preferences[key] = parsed
	}
	if err := f.Store.Client.User.UpdateOneID(p.User.ID).SetPreferences(preferences).Exec(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	respond(w, 200, preferences)
}

func (f *Framework) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decode(r, &input); err != nil || len(input.NewPassword) < 12 {
		fail(w, 400, "invalid_password", "新密码至少需要 12 位")
		return
	}
	p := fromContext(r.Context())
	if bcrypt.CompareHashAndPassword([]byte(p.User.PasswordHash), []byte(input.CurrentPassword)) != nil {
		fail(w, 400, "invalid_password", "当前密码错误")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "password_error", "密码处理失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(p.User.ID).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Exec(r.Context()); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDEQ(p.User.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("change_password").SetResource("users").SetResourceID(p.User.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "修改密码失败")
		return
	}
	expireCookie(w, f.config.SecureCookies)
	respond(w, 200, nil)
}

func (f *Framework) listSessions(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	rows, err := f.Store.Client.Session.Query().Where(session.UserIDEQ(p.User.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询会话失败")
		return
	}
	list := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, map[string]any{"id": row.ID, "createdAt": row.CreatedAt, "expiresAt": row.ExpiresAt, "current": row.ID == p.Session.ID, "tenantViewId": row.TenantViewID})
	}
	respond(w, 200, list)
}

func (f *Framework) revokeSession(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	count, err := f.Store.Client.Session.Update().Where(session.IDEQ(id), session.UserIDEQ(p.User.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "下线失败")
		return
	}
	if count == 0 {
		fail(w, 404, "not_found", "会话不存在")
		return
	}
	if id == p.Session.ID {
		expireCookie(w, f.config.SecureCookies)
	}
	respond(w, 200, nil)
}
