package zenith

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

func (f *Framework) updateProfile(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	u := p.User
	in := userInput{Username: u.Username, Nickname: u.Nickname, Email: u.Email, Phone: u.Phone, Gender: u.Gender, BirthDate: u.BirthDate, Avatar: u.Avatar, Status: u.Status, DepartmentID: u.DepartmentID}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_profile", "个人资料无效")
		return
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "nickname":
			err = json.Unmarshal(raw, &in.Nickname)
		case "email":
			err = json.Unmarshal(raw, &in.Email)
		case "phone":
			err = json.Unmarshal(raw, &in.Phone)
		case "gender":
			err = json.Unmarshal(raw, &in.Gender)
		case "birthDate":
			err = json.Unmarshal(raw, &in.BirthDate)
		case "avatar":
			err = json.Unmarshal(raw, &in.Avatar)
		default:
			fail(w, 400, "invalid_profile", "未知个人资料字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_profile", "字段格式无效")
			return
		}
	}
	if err := validateUser(in, false); err != nil {
		fail(w, 400, "invalid_profile", err.Error())
		return
	}
	var result *ent.User
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		update := tx.User.UpdateOneID(u.ID)
		applyUserUpdate(update, in)
		result, err = update.Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(u.ID).SetRequestID(requestID(r)).SetOperation("update_profile").SetResource("users").SetResourceID(u.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	view, err := f.userView(r, result)
	if err != nil {
		fail(w, 503, "database_unavailable", "读取资料失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Overrides map[string]any `json:"overrides"`
	}
	if err := decode(r, &input); err != nil || input.Overrides == nil || contracts.ValidatePreferences(input.Overrides) != nil {
		fail(w, 400, "invalid_preferences", "个人偏好无效")
		return
	}
	value, _, err := f.loadSetting(r.Context(), "ui")
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取偏好策略失败")
		return
	}
	policy := value["preferences"].(map[string]any)
	allowed := policy["allowUserOverride"].(map[string]any)
	for key := range input.Overrides {
		if allowed[key] != true {
			fail(w, 403, "preference_locked", "系统策略禁止修改该偏好")
			return
		}
	}
	p := fromContext(r.Context())
	if err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(p.User.ID).SetPreferences(input.Overrides).Exec(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("update_preferences").SetResource("users").SetResourceID(p.User.ID).Exec(r.Context())
	}); err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	respond(w, 200, map[string]any{"overrides": input.Overrides})
}

func (f *Framework) getPreferences(w http.ResponseWriter, r *http.Request) {
	preferences := fromContext(r.Context()).User.Preferences
	if preferences == nil {
		preferences = map[string]any{}
	}
	respond(w, 200, map[string]any{"overrides": preferences})
}

func (f *Framework) preferencePolicy(w http.ResponseWriter, r *http.Request) {
	value, _, err := f.loadSetting(r.Context(), "ui")
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取偏好策略失败")
		return
	}
	respond(w, 200, value["preferences"])
}

func (f *Framework) favoriteMenus(w http.ResponseWriter, r *http.Request) {
	ids := fromContext(r.Context()).User.FavoriteMenus
	if ids == nil {
		ids = []int{}
	}
	respond(w, 200, ids)
}

func (f *Framework) saveFavoriteMenus(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err := decode(r, &input); err != nil || input.MenuIDs == nil || len(input.MenuIDs) > 100 {
		fail(w, 400, "invalid_menus", "收藏菜单无效")
		return
	}
	p := fromContext(r.Context())
	rows, err := f.accessibleMenus(r.Context(), p)
	if err != nil {
		fail(w, 503, "database_unavailable", "菜单不可用")
		return
	}
	allowed := map[int]bool{}
	for _, row := range rows {
		allowed[row.ID] = row.Type == "menu"
	}
	for _, id := range input.MenuIDs {
		if !allowed[id] {
			fail(w, 403, "forbidden", "菜单不可访问")
			return
		}
	}
	if err := f.Store.Client.User.UpdateOneID(p.User.ID).SetFavoriteMenus(input.MenuIDs).Exec(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "保存失败")
		return
	}
	respond(w, 200, input.MenuIDs)
}

func (f *Framework) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"oldPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decode(r, &input); err != nil || len(input.NewPassword) < 6 {
		fail(w, 400, "invalid_password", "新密码至少需要 6 位")
		return
	}
	if err := f.validatePassword(r.Context(), input.NewPassword); err != nil {
		fail(w, 400, "invalid_password", err.Error())
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
		list = append(list, sessionView(row, p))
	}
	respond(w, 200, list)
}

func (f *Framework) revokeSession(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["tokenId"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	count := 0
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		count, err = tx.Session.Update().Where(session.IDEQ(id), session.UserIDEQ(p.User.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(r.Context())
		if err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("revoke_session").SetResource("sessions").SetResourceID(id).Exec(r.Context())
	})
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

func (f *Framework) deleteOtherSessions(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	count := 0
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		count, err = tx.Session.Update().Where(session.UserIDEQ(p.User.ID), session.IDNEQ(p.Session.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).SetRevokedAt(time.Now()).Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("revoke_other_sessions").SetResource("users").SetResourceID(p.User.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "下线失败")
		return
	}
	respond(w, 200, map[string]int{"count": count})
}
