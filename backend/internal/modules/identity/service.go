package identity

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/captcha"
	"github.com/fudanda/arcbase/backend/ent/loginattempt"
	"github.com/fudanda/arcbase/backend/ent/session"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"golang.org/x/crypto/bcrypt"
)

type Dependencies struct {
	EffectiveRoleIDs func(context.Context, int) ([]int, error)

	UserView           func(ctx context.Context, inArgs kernel.Input, account *ent.User) (map[string]any, error)
	LoadSetting        func(ctx context.Context, module string) (map[string]any, *ent.SystemSetting, error)
	AccessibleMenus    func(ctx context.Context, p *kernel.Principal) ([]*ent.Menu, error)
	Permissions        func(ctx context.Context, p *kernel.Principal) ([]string, error)
	PersistFile        func(ctx context.Context, p *kernel.Principal, input io.Reader, rawName, visibility, trace string, maxBytes int64) (map[string]any, error)
	VisibleMemberQuery func(ctx context.Context, p *kernel.Principal, query *ent.UserQuery) (*ent.UserQuery, error)
	VisibleUser        func(ctx context.Context, p *kernel.Principal, id int) (*ent.User, error)
	ProtectedBatchUser func(ctx context.Context, inArgs kernel.Input, id int) (bool, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

type loginInput struct {
	Username string `json:"username"`
	Password string `json:"password"`

	CaptchaID     string `json:"captchaId"`
	CaptchaAnswer string `json:"captchaAnswer"`
}

var uppercasePassword = regexp.MustCompile(`[A-Z]`)

var specialPassword = regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]`)

func SourceKey(name, ip string) string { return kernel.Digest(strings.ToLower(name) + ":" + ip) }

var errSessionConflict = errors.New("session concurrency limit reached")

func browserName(agent string) string {
	for _, name := range []string{"Edg/", "Firefox/", "Chrome/", "Safari/"} {
		if strings.Contains(agent, name) {
			return strings.TrimSuffix(name, "/")
		}
	}
	return ""
}

func osName(agent string) string {
	for _, name := range []string{"Android", "iPhone", "iPad", "Windows", "Mac OS", "Linux"} {
		if strings.Contains(agent, name) {
			return name
		}
	}
	return ""
}

func (f *Service) UpdateProfile(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	u := p.User
	in := kernel.UserInput{Username: u.Username, Nickname: u.Nickname, Email: u.Email, Phone: u.Phone, Gender: u.Gender, BirthDate: u.BirthDate, Avatar: u.Avatar, Status: u.Status, DepartmentID: u.DepartmentID}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_profile", "个人资料无效")
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
			return kernel.Outcome{}, kernel.Fail(400, "invalid_profile", "未知个人资料字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_profile", "字段格式无效")
		}
	}
	if err := kernel.ValidateUser(in, false); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_profile", err.Error())
	}
	var result *ent.User
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		update := tx.User.UpdateOneID(u.ID)
		kernel.ApplyUserUpdate(update, in)
		result, err = update.Save(ctx)
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(u.ID).SetRequestID(inArgs.TraceID).SetOperation("update_profile").SetResource("users").SetResourceID(u.ID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	view, err := f.deps.UserView(ctx, inArgs, result)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "读取资料失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) UpdatePreferences(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var input struct {
		Overrides map[string]any `json:"overrides"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &input); err != nil || input.Overrides == nil || contracts.ValidatePreferences(input.Overrides) != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_preferences", "个人偏好无效")
	}
	value, _, err := f.deps.LoadSetting(ctx, "ui")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取偏好策略失败")
	}
	policy := value["preferences"].(map[string]any)
	allowed := policy["allowUserOverride"].(map[string]any)
	for key := range input.Overrides {
		if allowed[key] != true {
			return kernel.Outcome{}, kernel.Fail(403, "preference_locked", "系统策略禁止修改该偏好")
		}
	}
	p := kernel.FromContext(ctx)
	if err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(p.User.ID).SetPreferences(input.Overrides).Exec(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("update_preferences").SetResource("users").SetResourceID(p.User.ID).Exec(ctx)
	}); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	return kernel.Success(200, map[string]any{"overrides": input.Overrides})
}

func (f *Service) GetPreferences(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	preferences := kernel.FromContext(ctx).User.Preferences
	if preferences == nil {
		preferences = map[string]any{}
	}
	return kernel.Success(200, map[string]any{"overrides": preferences})
}

func (f *Service) PreferencePolicy(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	value, _, err := f.deps.LoadSetting(ctx, "ui")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取偏好策略失败")
	}
	return kernel.Success(200, value["preferences"])
}

func (f *Service) FavoriteMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	ids := kernel.FromContext(ctx).User.FavoriteMenus
	if ids == nil {
		ids = []int{}
	}
	return kernel.Success(200, ids)
}

func (f *Service) SaveFavoriteMenus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var input struct {
		MenuIDs []int `json:"menuIds"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &input); err != nil || input.MenuIDs == nil || len(input.MenuIDs) > 100 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_menus", "收藏菜单无效")
	}
	p := kernel.FromContext(ctx)
	rows, err := f.deps.AccessibleMenus(ctx, p)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "菜单不可用")
	}
	allowed := map[int]bool{}
	for _, row := range rows {
		allowed[row.ID] = row.Type == "menu"
	}
	for _, id := range input.MenuIDs {
		if !allowed[id] {
			return kernel.Outcome{}, kernel.Fail(403, "forbidden", "菜单不可访问")
		}
	}
	if err := f.Store.Client.User.UpdateOneID(p.User.ID).SetFavoriteMenus(input.MenuIDs).Exec(ctx); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "保存失败")
	}
	return kernel.Success(200, input.MenuIDs)
}

func (f *Service) ChangePassword(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var input struct {
		CurrentPassword string `json:"oldPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &input); err != nil || len(input.NewPassword) < 6 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", "新密码至少需要 6 位")
	}
	if err := f.ValidatePassword(ctx, input.NewPassword); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", err.Error())
	}
	p := kernel.FromContext(ctx)
	if bcrypt.CompareHashAndPassword([]byte(p.User.PasswordHash), []byte(input.CurrentPassword)) != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_password", "当前密码错误")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "password_error", "密码处理失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(p.User.ID).SetPasswordHash(string(hash)).SetPasswordUpdatedAt(time.Now()).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.Session.Update().Where(session.UserIDEQ(p.User.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("change_password").SetResource("users").SetResourceID(p.User.ID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "修改密码失败")
	}
	return kernel.Outcome{Status: 200, Cookie: &kernel.SessionCookie{Clear: true}}, nil
}

func (f *Service) ListSessions(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	rows, err := f.Store.Client.Session.Query().Where(session.UserIDEQ(p.User.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询会话失败")
	}
	list := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, kernel.SessionView(row, p))
	}
	return kernel.Success(200, list)
}

func (f *Service) RevokeSession(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.TokenId)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	count := 0
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		count, err = tx.Session.Update().Where(session.IDEQ(id), session.UserIDEQ(p.User.ID), session.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx)
		if err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("revoke_session").SetResource("sessions").SetResourceID(id).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "下线失败")
	}
	if count == 0 {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "会话不存在")
	}
	result := kernel.Outcome{Status: 200}
	if id == p.Session.ID {
		result.Cookie = &kernel.SessionCookie{Clear: true}
	}
	return result, nil
}

func (f *Service) DeleteOtherSessions(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	count := 0
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		count, err = tx.Session.Update().Where(session.UserIDEQ(p.User.ID), session.IDNEQ(p.Session.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now())).SetRevokedAt(time.Now()).Save(ctx)
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("revoke_other_sessions").SetResource("users").SetResourceID(p.User.ID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "下线失败")
	}
	return kernel.Success(200, map[string]int{"count": count})
}

func (f *Service) CreateCaptcha(ctx context.Context, complexity string) (string, string, error) {
	id, err := kernel.Secret()
	if err != nil {
		return "", "", err
	}
	answerSecret, err := kernel.Secret()
	if err != nil {
		return "", "", err
	}
	length := 6
	if complexity == "low" {
		length = 4
	}
	if complexity == "high" {
		length = 8
	}
	answer := strings.ToUpper(answerSecret[:length])
	if _, err = f.Store.Client.Captcha.Create().SetPublicID(id).SetAnswerHash(kernel.Digest(answer)).SetExpiresAt(time.Now().Add(5 * time.Minute)).Save(ctx); err != nil {
		return "", "", err
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48"><rect width="180" height="48" fill="#eef2ff"/><text x="15" y="33" font-family="monospace" font-size="25" letter-spacing="4" fill="#242a50">%s</text></svg>`, html.EscapeString(answer))
	return id, "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg)), nil
}

func (f *Service) Captcha(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, _, err := f.deps.LoadSetting(ctx, "auth")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "验证码不可用")
	}
	if settings["captchaEnabled"] != true {
		return kernel.Success(200, map[string]any{"enabled": false, "captchaId": "", "image": ""})
	}
	id, image, err := f.CreateCaptcha(ctx, settings["captchaComplexity"].(string))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "验证码不可用")
	}
	return kernel.Success(200, map[string]any{"enabled": true, "captchaId": id, "image": image})
}

func (f *Service) Login(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	if !inArgs.SourceValid {
		return kernel.Outcome{}, kernel.Fail(403, "origin_invalid", "请求来源不合法")
	}
	var in loginInput
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.Username == "" || in.Password == "" || len(in.Username) > 128 || len(in.Password) > 1024 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "登录参数不完整")
	}
	policy, err := f.SecurityPolicy(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	settings, _, err := f.deps.LoadSetting(ctx, "auth")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	account, err := f.Store.Client.User.Query().Where(user.Or(user.UsernameEQ(in.Username), user.PhoneEQ(in.Username))).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	name := in.Username
	if account != nil {
		name = account.Username
	}
	required, err := f.RequiresChallenge(ctx, name, inArgs.IP, policy)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	required = required || settings["captchaEnabled"] == true
	if required && (in.CaptchaID == "" || in.CaptchaAnswer == "") {
		id, image, err := f.CreateCaptcha(ctx, settings["captchaComplexity"].(string))
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "验证码不可用")
		}
		return kernel.Success(200, map[string]any{"captchaRequired": true, "captchaId": id, "svg": image, "message": "请输入验证码后继续登录"})
	}
	if required || in.CaptchaID != "" {
		challenge, err := f.Store.Client.Captcha.Query().Where(captcha.PublicIDEQ(in.CaptchaID)).Only(ctx)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(400, "captcha_invalid", "验证码无效")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
		}
		if challenge.UsedAt != nil || time.Now().After(challenge.ExpiresAt) {
			return kernel.Outcome{}, kernel.Fail(400, "captcha_invalid", "验证码无效")
		}
		count, err := f.Store.Client.Captcha.Update().Where(captcha.IDEQ(challenge.ID), captcha.UsedAtIsNil()).SetUsedAt(time.Now()).Save(ctx)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
		}
		if count != 1 || subtle.ConstantTimeCompare([]byte(challenge.AnswerHash), []byte(kernel.Digest(strings.ToUpper(in.CaptchaAnswer)))) != 1 {
			return kernel.Outcome{}, kernel.Fail(400, "captcha_invalid", "验证码错误或已使用")
		}
	}
	valid := account != nil && account.Status == "enabled" && bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(in.Password)) == nil
	if !valid {
		if err = f.RecordLoginFailure(ctx, name, inArgs.IP, policy); err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
		}
		log := f.Store.Client.LoginLog.Create().SetUsername(name).SetSuccess(false).SetReason("账号或密码错误").SetIP(inArgs.IP)
		if account != nil {
			log.SetUserID(account.ID)
		}
		if err = log.Exec(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
		}
		return kernel.Outcome{}, kernel.Fail(401, "invalid_credentials", "账号或密码错误")
	}
	return f.IssueSession(ctx, inArgs, account, false)
}

func (f *Service) Me(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	csrfToken := kernel.Digest("arcbase-csrf:" + inArgs.SessionToken)
	permissions, err := f.deps.Permissions(ctx, p)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	view, err := f.deps.UserView(ctx, inArgs, p.User)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "用户资料查询失败")
	}

	return kernel.Success(200, map[string]any{"user": view, "superAdmin": p.SuperAdmin, "permissions": permissions, "csrfToken": csrfToken})
}

func (f *Service) Logout(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.Session.UpdateOneID(p.Session.ID).SetRevokedAt(time.Now()).Exec(ctx); err != nil {
			return err
		}
		return tx.LoginLog.Create().SetUserID(p.User.ID).SetUsername(p.User.Username).SetSuccess(true).SetEventType("logout").SetIP(inArgs.IP).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "退出失败")
	}
	return kernel.Outcome{Status: 200, Cookie: &kernel.SessionCookie{Clear: true}}, nil
}

func (f *Service) CleanupAuthentication(ctx context.Context, now time.Time) error {
	_, challenges := f.Store.Client.Captcha.Delete().Where(captcha.Or(captcha.ExpiresAtLT(now), captcha.UsedAtNotNil())).Exec(ctx)
	_, sessions := f.Store.Client.Session.Delete().Where(session.Or(session.ExpiresAtLT(now), session.RevokedAtLT(now.Add(-7*24*time.Hour)))).Exec(ctx)
	_, attempts := f.Store.Client.LoginAttempt.Delete().Where(loginattempt.UpdatedAtLT(now.Add(-24 * time.Hour))).Exec(ctx)
	return errors.Join(challenges, sessions, attempts)
}

func (f *Service) UploadAvatar(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	file := inArgs.Upload
	raw, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_upload", "头像不得超过 2 MB")
	}
	dimensions, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || dimensions.Width > 4096 || dimensions.Height > 4096 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_avatar", "头像需要有效 JPEG 或 PNG 图片，尺寸不超过 4096")
	}
	if _, _, err := image.Decode(bytes.NewReader(raw)); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_avatar", "头像图片不完整或已损坏")
	}
	name := "avatar.jpg"
	if format == "png" {
		name = "avatar.png"
	}
	view, err := f.deps.PersistFile(ctx, kernel.FromContext(ctx), bytes.NewReader(raw), name, "public", inArgs.TraceID, 2<<20)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "upload_failed", err.Error())
	}
	return kernel.Success(200, view)
}

func (f *Service) SecurityPolicy(ctx context.Context) (kernel.SecurityPolicy, error) {
	value, _, err := f.deps.LoadSetting(ctx, "identitySecurity")
	if err != nil {
		return kernel.SecurityPolicy{}, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return kernel.SecurityPolicy{}, err
	}
	var policy kernel.SecurityPolicy
	err = json.Unmarshal(raw, &policy)
	return policy, err
}

func (f *Service) ValidatePassword(ctx context.Context, password string) error {
	policy, err := f.SecurityPolicy(ctx)
	if err != nil {
		return err
	}
	length := len(utf16.Encode([]rune(password)))
	if length < policy.Password.MinLength || length > 64 || len(password) > 72 {
		return fmt.Errorf("密码需要 %d 至 64 位，编码后不超过 72 字节", policy.Password.MinLength)
	}
	if policy.Password.RequireUppercase && !uppercasePassword.MatchString(password) {
		return errors.New("密码必须包含至少一个大写字母")
	}
	if policy.Password.RequireSpecialChar && !specialPassword.MatchString(password) {
		return errors.New("密码必须包含至少一个特殊字符")
	}
	return nil
}

func (f *Service) RequiresChallenge(ctx context.Context, name, ip string, policy kernel.SecurityPolicy) (bool, error) {
	rows, err := f.Store.Client.LoginAttempt.Query().Where(loginattempt.UsernameHashEQ(kernel.UsernameHash(name)), loginattempt.LockedUntilGT(time.Now())).All(ctx)
	if err != nil {
		return false, err
	}
	if len(rows) >= policy.LoginChallenge.SourceLimit {
		return true, nil
	}
	for _, row := range rows {
		if row.Key == SourceKey(name, ip) && row.Failures >= policy.LoginChallenge.MaxAttemptsPerSource {
			return true, nil
		}
	}
	return false, nil
}

func (f *Service) RecordLoginFailure(ctx context.Context, name, ip string, policy kernel.SecurityPolicy) error {
	now := time.Now().UTC()
	until := now.Add(time.Duration(policy.LoginChallenge.WindowMinutes) * time.Minute)
	// Both dialects support this atomic upsert, including simultaneous first
	// failures. Bind times instead of database-specific interval expressions.
	_, err := f.Store.DB.ExecContext(ctx, `INSERT INTO login_attempts(key,username_hash,failures,locked_until,updated_at) VALUES($1,$2,1,$3,$4) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN login_attempts.locked_until>excluded.updated_at THEN login_attempts.failures+1 ELSE 1 END,locked_until=excluded.locked_until,updated_at=excluded.updated_at`, SourceKey(name, ip), kernel.UsernameHash(name), until, now)
	return err
}

func (f *Service) ResolveSessionConflict(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	if !inArgs.SourceValid {
		return kernel.Outcome{}, kernel.Fail(403, "origin_invalid", "请求来源不合法")
	}
	var in struct {
		Ticket string `json:"ticket"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || len(in.Ticket) != 64 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_ticket", "登录票据无效")
	}
	row, err := f.Store.Client.Session.Query().Where(session.TokenHashEQ(kernel.Digest("ticket:"+in.Ticket)), session.ExpiresAtGT(time.Now())).Only(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_ticket", "登录票据已过期")
	}
	count, err := f.Store.Client.Session.Update().Where(session.IDEQ(row.ID), session.ExpiresAtGT(time.Now())).SetExpiresAt(time.Now()).Save(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	if count != 1 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_ticket", "登录票据已使用")
	}
	account, err := f.Store.Client.User.Get(ctx, row.UserID)
	if err != nil || account.Status != "enabled" || account.PasswordUpdatedAt.After(row.CreatedAt) {
		return kernel.Outcome{}, kernel.Fail(401, "invalid_credentials", "账号状态已变更，请重新登录")
	}
	return f.IssueSession(ctx, inArgs, account, true)
}

func (f *Service) OnlineSessions(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	page, err := kernel.PositiveInt(inArgs.Filter.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	size, err := kernel.PositiveInt(inArgs.Filter.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	users, err := f.deps.VisibleMemberQuery(ctx, p, f.Store.Client.User.Query().Where(user.StatusEQ("enabled")))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "数据权限查询失败")
	}
	accounts, err := users.All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "账号查询失败")
	}
	byID := map[int]*ent.User{}
	ids := make([]int, 0, len(accounts))
	for _, account := range accounts {
		byID[account.ID] = account
		ids = append(ids, account.ID)
	}
	query := f.Store.Client.Session.Query().Where(session.UserIDIn(ids...), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now()))
	if client := inArgs.Filter.Get("client"); client != "" {
		if client != "web" && client != "desktop" && client != "mobile" {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_query", "终端类型无效")
		}
		query = query.Where(session.ClientEQ(client))
	}
	keyword := strings.ToLower(strings.TrimSpace(inArgs.Filter.Get("keyword")))
	rows, err := query.Order(ent.Desc(session.FieldLastActiveAt)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "会话查询失败")
	}
	list := make([]map[string]any, 0)
	for _, row := range rows {
		account := byID[row.UserID]
		if keyword != "" && !strings.Contains(strings.ToLower(account.Username+account.Nickname+row.IP), keyword) {
			continue
		}
		item := kernel.SessionView(row, p)
		item["userId"] = account.ID
		item["username"] = account.Username
		item["nickname"] = account.Nickname
		list = append(list, item)
	}
	total := len(list)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	return kernel.Success(200, map[string]any{"list": list[start:end], "total": total, "page": page, "pageSize": size})
}

func (f *Service) ForceLogout(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	vars := map[string]string{"id": inArgs.Id, "tokenId": inArgs.TokenId}
	uid, err := kernel.IntParam(vars["id"])
	sid := 0
	if vars["tokenId"] != "" {
		sid, err = kernel.IntParam(vars["tokenId"])
		if err == nil {
			row, e := f.Store.Client.Session.Get(ctx, sid)
			if e != nil {
				return kernel.Outcome{}, kernel.Fail(404, "not_found", "会话不存在")
			}
			uid = row.UserID
		}
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.deps.VisibleUser(ctx, p, uid); err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "账号不在可管理范围")
	}
	protected, err := f.deps.ProtectedBatchUser(ctx, inArgs, uid)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "授权查询失败")
	}
	if protected && !p.SuperAdmin {
		return kernel.Outcome{}, kernel.Fail(403, "protected_user", "不能强制下线系统超级管理员")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		q := tx.Session.Update().Where(session.UserIDEQ(uid), session.RevokedAtIsNil())
		if sid != 0 {
			q = q.Where(session.IDEQ(sid))
		}
		if _, err := q.SetRevokedAt(time.Now()).Save(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("force_logout").SetResource("users").SetResourceID(uid).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "强制下线失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) Authenticate(ctx context.Context, token string) (*kernel.Principal, error) {
	if len(token) != 64 {
		return nil, kernel.ErrUnauthenticated
	}
	sess, err := f.Store.Client.Session.Query().Where(session.TokenHashEQ(kernel.Digest(token))).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, kernel.ErrUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if sess.RevokedAt != nil || !sess.ExpiresAt.After(time.Now()) {
		return nil, kernel.ErrUnauthenticated
	}
	u, err := f.Store.Client.User.Get(ctx, sess.UserID)
	if ent.IsNotFound(err) {
		return nil, kernel.ErrUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if u.Status != "enabled" || u.PasswordUpdatedAt.After(sess.CreatedAt) {
		return nil, kernel.ErrUnauthenticated
	}

	if time.Since(sess.LastActiveAt) > 30*time.Second {
		if err := f.Store.Client.Session.UpdateOneID(sess.ID).SetLastActiveAt(time.Now()).Exec(ctx); err != nil {
			return nil, err
		}
	}
	policy, err := f.SecurityPolicy(ctx)
	if err != nil {
		return nil, err
	}
	p := &kernel.Principal{User: u, Session: sess, PasswordChangeRequired: policy.Password.ExpiryEnabled && u.PasswordUpdatedAt.AddDate(0, 0, policy.Password.ExpiryDays).Before(time.Now())}
	roles, err := f.deps.EffectiveRoleIDs(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	for _, id := range roles {
		roleRow, err := f.Store.Client.Role.Get(ctx, id)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if roleRow.Status == "enabled" && roleRow.Code == "super_admin" {
			p.SuperAdmin = true
		}
	}

	return p, nil
}
func (f *Service) IssueSession(ctx context.Context, inArgs kernel.Input, account *ent.User, replaceAll bool) (kernel.Outcome, error) {
	policy, err := f.SecurityPolicy(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	token, err := kernel.Secret()
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "random_unavailable", "登录服务不可用")
	}
	csrfToken := kernel.Digest("arcbase-csrf:" + token)
	expires := time.Now().Add(12 * time.Hour)
	var conflicts []*ent.Session
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		// Lock the account row so concurrent logins cannot both occupy the last slot.
		fresh, err := tx.User.UpdateOneID(account.ID).SetUpdatedAt(time.Now()).Save(ctx)
		if err != nil {
			return err
		}
		if fresh.Status != "enabled" || fresh.PasswordHash != account.PasswordHash {
			return kernel.ErrUnauthenticated
		}
		query := tx.Session.Query().Where(session.UserIDEQ(account.ID), session.RevokedAtIsNil(), session.ExpiresAtGT(time.Now()))
		conflicts, err = query.Order(ent.Asc(session.FieldCreatedAt)).All(ctx)
		if err != nil {
			return err
		}
		if replaceAll {
			for _, row := range conflicts {
				if err = tx.Session.UpdateOneID(row.ID).SetRevokedAt(time.Now()).Exec(ctx); err != nil {
					return err
				}
			}
			conflicts = nil
		}
		if policy.Session.MaxSessions > 0 && len(conflicts) >= policy.Session.MaxSessions {
			if policy.Session.ExceedAction == "reject-new" {
				return errSessionConflict
			}
			for _, row := range conflicts[:len(conflicts)-policy.Session.MaxSessions+1] {
				if err = tx.Session.UpdateOneID(row.ID).SetRevokedAt(time.Now()).Exec(ctx); err != nil {
					return err
				}
			}
		}
		if inArgs.SessionToken != "" {
			if _, err = tx.Session.Update().Where(session.TokenHashEQ(kernel.Digest(inArgs.SessionToken))).SetRevokedAt(time.Now()).Save(ctx); err != nil {
				return err
			}
		}
		if err = tx.Session.Create().SetUserID(account.ID).SetTokenHash(kernel.Digest(token)).SetCsrfHash(kernel.Digest(csrfToken)).SetExpiresAt(expires).SetIP(inArgs.IP).SetBrowser(browserName(inArgs.UserAgent)).SetOs(osName(inArgs.UserAgent)).Exec(ctx); err != nil {
			return err
		}
		if _, err = tx.LoginAttempt.Delete().Where(loginattempt.KeyEQ(SourceKey(account.Username, inArgs.IP))).Exec(ctx); err != nil {
			return err
		}
		return tx.LoginLog.Create().SetUserID(account.ID).SetUsername(account.Username).SetSuccess(true).SetIP(inArgs.IP).Exec(ctx)
	})
	if errors.Is(err, errSessionConflict) {
		ticket, e := kernel.Secret()
		if e != nil {
			return kernel.Outcome{}, kernel.Fail(500, "random_unavailable", "登录服务不可用")
		}
		until := time.Now().Add(5 * time.Minute)
		if err = f.Store.Client.Session.Create().SetUserID(account.ID).SetTokenHash(kernel.Digest("ticket:" + ticket)).SetCsrfHash("").SetExpiresAt(until).SetRevokedAt(time.Now()).Exec(ctx); err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
		}
		sessions := make([]map[string]any, 0, len(conflicts))
		for _, row := range conflicts {
			sessions = append(sessions, kernel.SessionView(row, &kernel.Principal{}))
		}
		return kernel.Success(200, map[string]any{"sessionConflict": true, "ticket": ticket, "maxSessions": policy.Session.MaxSessions, "sessions": sessions, "expiresAt": until.UnixMilli()})

	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	p, err := f.Authenticate(ctx, token)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	permissions, err := f.deps.Permissions(ctx, p)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "登录服务不可用")
	}
	view, err := f.deps.UserView(ctx, inArgs, account)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "用户资料查询失败")
	}
	return kernel.Outcome{Status: 200, Data: map[string]any{"user": view, "csrfToken": csrfToken, "superAdmin": p.SuperAdmin, "permissions": permissions}, Cookie: &kernel.SessionCookie{Token: token, Expires: expires}}, nil
}
