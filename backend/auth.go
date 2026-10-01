package zenith

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/captcha"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/rolemenu"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"github.com/fudanda/zenith-admin/backend/internal/security"
	"golang.org/x/crypto/bcrypt"
)

var errUnauthenticated = errors.New("authentication required")

type principal = security.Principal

var fromContext = security.FromContext

func (f *Framework) principal(ctx context.Context, r *http.Request) (*principal, error) {
	cookie, err := r.Cookie("zenith_session")
	if err != nil || len(cookie.Value) != 64 {
		return nil, errUnauthenticated
	}
	sess, err := f.Store.Client.Session.Query().Where(session.TokenHashEQ(digest(cookie.Value))).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, errUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if sess.RevokedAt != nil || !sess.ExpiresAt.After(time.Now()) {
		return nil, errUnauthenticated
	}
	u, err := f.Store.Client.User.Get(ctx, sess.UserID)
	if ent.IsNotFound(err) {
		return nil, errUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if u.Status != "enabled" || u.PasswordUpdatedAt.After(sess.CreatedAt) {
		return nil, errUnauthenticated
	}

	if time.Since(sess.LastActiveAt) > 30*time.Second {
		if err := f.Store.Client.Session.UpdateOneID(sess.ID).SetLastActiveAt(time.Now()).Exec(ctx); err != nil {
			return nil, err
		}
	}
	policy, err := f.securityPolicy(ctx)
	if err != nil {
		return nil, err
	}
	p := &principal{User: u, Session: sess, PasswordChangeRequired: policy.Password.ExpiryEnabled && u.PasswordUpdatedAt.AddDate(0, 0, policy.Password.ExpiryDays).Before(time.Now())}
	roles, err := f.effectiveRoleIDs(ctx, u.ID)
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

func (f *Framework) effectiveRoleIDs(ctx context.Context, userID int) ([]int, error) {
	assignments, err := f.Store.Client.UserRole.Query().Where(userrole.UserIDEQ(userID)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[int]bool{}
	for _, assignment := range assignments {
		ids[assignment.RoleID] = true
	}
	memberships, err := f.Store.Client.UserGroupMember.Query().Where(usergroupmember.UserIDEQ(userID)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, membership := range memberships {
		group, err := f.Store.Client.UserGroup.Get(ctx, membership.GroupID)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if group.Status != "enabled" {
			continue
		}

		links, err := f.Store.Client.UserGroupRole.Query().Where(usergrouprole.GroupIDEQ(group.ID)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, link := range links {
			ids[link.RoleID] = true
		}
	}
	result := make([]int, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	return result, nil
}

func (f *Framework) accessibleMenus(ctx context.Context, p *principal) ([]*ent.Menu, error) {
	query := f.Store.Client.Menu.Query().Where(menu.StatusEQ("enabled"))
	if !p.SuperAdmin {
		ids := map[int]bool{}
		direct, err := f.Store.Client.UserMenu.Query().Where(usermenu.UserIDEQ(p.User.ID)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, grant := range direct {
			ids[grant.MenuID] = true
		}
		roles, err := f.effectiveRoleIDs(ctx, p.User.ID)
		if err != nil {
			return nil, err
		}
		for _, id := range roles {
			_, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
			if ent.IsNotFound(err) {
				continue
			}
			if err != nil {
				return nil, err
			}

			grants, err := f.Store.Client.RoleMenu.Query().Where(rolemenu.RoleIDEQ(id)).All(ctx)
			if err != nil {
				return nil, err
			}
			for _, grant := range grants {
				ids[grant.MenuID] = true
			}
		}
		if len(ids) == 0 {
			return []*ent.Menu{}, nil
		}
		selected := make([]int, 0, len(ids))
		for id := range ids {
			selected = append(selected, id)
		}
		query = query.Where(menu.IDIn(selected...))
	}
	rows, err := query.Order(ent.Asc(menu.FieldSort), ent.Asc(menu.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (f *Framework) permissions(ctx context.Context, p *principal) ([]string, error) {
	if p.SuperAdmin {
		return []string{"*"}, nil
	}
	rows, err := f.accessibleMenus(ctx, p)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, row := range rows {
		if row.Permission != nil && *row.Permission != "" {
			set[*row.Permission] = true
		}
	}
	result := make([]string, 0, len(set))
	for permission := range set {
		result = append(result, permission)
	}
	return result, nil
}

func (f *Framework) permitted(ctx context.Context, p *principal, permission string) (bool, error) {
	if p.SuperAdmin {
		return true, nil
	}
	permissions, err := f.permissions(ctx, p)
	if err != nil {
		return false, err
	}
	for _, candidate := range permissions {
		if candidate == permission {
			return true, nil
		}
	}
	return false, nil
}

func (f *Framework) guard(route Route) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		r, err = withRequestMetadata(w, r, route)
		if err != nil {
			fail(w, 413, "invalid_request", "请求内容过大或无效")
			return
		}
		if route.Public {
			if err := validateContractRequest(r, route.OperationID); err != nil {
				fail(w, 400, "invalid_request", err.Error())
				return
			}
			route.Handler.ServeHTTP(w, r)
			return
		}
		p, err := f.principal(r.Context(), r)
		if errors.Is(err, errUnauthenticated) {
			fail(w, 401, "unauthorized", "请重新登录")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "认证服务不可用")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			value := r.Header.Get("X-CSRF-Token")
			if len(value) != 64 || subtle.ConstantTimeCompare([]byte(digest(value)), []byte(p.Session.CsrfHash)) != 1 {
				fail(w, 403, "csrf_invalid", "CSRF 校验失败")
				return
			}
		}
		if p.PasswordChangeRequired && r.Method != http.MethodGet && route.OperationID != "authChangePassword" && route.OperationID != "authLogout" {
			fail(w, 403, "password_expired", "密码已过期，请先在个人中心修改密码")
			return
		}
		if (route.Permission == "super_admin" || route.SuperAdminOnly) && !p.SuperAdmin {
			fail(w, 403, "forbidden", "需要系统管理员权限")
			return
		}
		if route.Permission != "authenticated" && route.Permission != "super_admin" {
			allowed, err := f.permitted(r.Context(), p, route.Permission)
			if err != nil {
				fail(w, 503, "database_unavailable", "授权服务不可用")
				return
			}
			if !allowed {
				fail(w, 403, "forbidden", "没有操作权限")
				return
			}
		}
		if len(route.AnyPermissions) > 0 && !p.SuperAdmin {
			allowed := false
			for _, candidate := range route.AnyPermissions {
				ok, err := f.permitted(r.Context(), p, candidate)
				if err != nil {
					fail(w, 503, "database_unavailable", "授权服务不可用")
					return
				}
				if ok {
					allowed = true
					break
				}
			}
			if !allowed {
				fail(w, 403, "forbidden", "没有操作权限")
				return
			}
		}
		if err := validateContractRequest(r, route.OperationID); err != nil {
			fail(w, 400, "invalid_request", err.Error())
			return
		}
		route.Handler.ServeHTTP(w, r.WithContext(security.WithPrincipal(r.Context(), p)))
	})
}

func sameOrigin(r *http.Request) bool {
	raw := r.Header.Get("Origin")
	if raw == "" {
		raw = r.Header.Get("Referer")
	}
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Host == r.Host && (u.Scheme == "https" || u.Scheme == "http")
}

func (f *Framework) createCaptcha(ctx context.Context, complexity string) (string, string, error) {
	id, err := secret()
	if err != nil {
		return "", "", err
	}
	answerSecret, err := secret()
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
	if _, err = f.Store.Client.Captcha.Create().SetPublicID(id).SetAnswerHash(digest(answer)).SetExpiresAt(time.Now().Add(5 * time.Minute)).Save(ctx); err != nil {
		return "", "", err
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48"><rect width="180" height="48" fill="#eef2ff"/><text x="15" y="33" font-family="monospace" font-size="25" letter-spacing="4" fill="#242a50">%s</text></svg>`, html.EscapeString(answer))
	return id, "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg)), nil
}
func (f *Framework) captcha(w http.ResponseWriter, r *http.Request) {
	settings, _, err := f.loadSetting(r.Context(), "auth")
	if err != nil {
		fail(w, 503, "database_unavailable", "验证码不可用")
		return
	}
	if settings["captchaEnabled"] != true {
		respond(w, 200, map[string]any{"enabled": false, "captchaId": "", "image": ""})
		return
	}
	id, image, err := f.createCaptcha(r.Context(), settings["captchaComplexity"].(string))
	if err != nil {
		fail(w, 503, "database_unavailable", "验证码不可用")
		return
	}
	respond(w, 200, map[string]any{"enabled": true, "captchaId": id, "image": image})
}

type loginInput struct {
	Username string `json:"username"`
	Password string `json:"password"`

	CaptchaID     string `json:"captchaId"`
	CaptchaAnswer string `json:"captchaAnswer"`
}

func (f *Framework) login(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		fail(w, 403, "origin_invalid", "请求来源不合法")
		return
	}
	var in loginInput
	if err := decode(r, &in); err != nil || in.Username == "" || in.Password == "" || len(in.Username) > 128 || len(in.Password) > 1024 {
		fail(w, 400, "invalid_request", "登录参数不完整")
		return
	}
	ctx := r.Context()
	policy, err := f.securityPolicy(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	settings, _, err := f.loadSetting(ctx, "auth")
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	account, err := f.Store.Client.User.Query().Where(user.Or(user.UsernameEQ(in.Username), user.PhoneEQ(in.Username))).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	name := in.Username
	if account != nil {
		name = account.Username
	}
	required, err := f.requiresChallenge(ctx, name, clientIP(r), policy)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	required = required || settings["captchaEnabled"] == true
	if required && (in.CaptchaID == "" || in.CaptchaAnswer == "") {
		id, image, err := f.createCaptcha(ctx, settings["captchaComplexity"].(string))
		if err != nil {
			fail(w, 503, "database_unavailable", "验证码不可用")
			return
		}
		respond(w, 200, map[string]any{"captchaRequired": true, "captchaId": id, "svg": image, "message": "请输入验证码后继续登录"})
		return
	}
	if required || in.CaptchaID != "" {
		challenge, err := f.Store.Client.Captcha.Query().Where(captcha.PublicIDEQ(in.CaptchaID)).Only(ctx)
		if ent.IsNotFound(err) {
			fail(w, 400, "captcha_invalid", "验证码无效")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		if challenge.UsedAt != nil || time.Now().After(challenge.ExpiresAt) {
			fail(w, 400, "captcha_invalid", "验证码无效")
			return
		}
		count, err := f.Store.Client.Captcha.Update().Where(captcha.IDEQ(challenge.ID), captcha.UsedAtIsNil()).SetUsedAt(time.Now()).Save(ctx)
		if err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		if count != 1 || subtle.ConstantTimeCompare([]byte(challenge.AnswerHash), []byte(digest(strings.ToUpper(in.CaptchaAnswer)))) != 1 {
			fail(w, 400, "captcha_invalid", "验证码错误或已使用")
			return
		}
	}
	valid := account != nil && account.Status == "enabled" && bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(in.Password)) == nil
	if !valid {
		if err = f.recordLoginFailure(ctx, name, clientIP(r), policy); err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		log := f.Store.Client.LoginLog.Create().SetUsername(name).SetSuccess(false).SetReason("账号或密码错误").SetIP(clientIP(r))
		if account != nil {
			log.SetUserID(account.ID)
		}
		if err = log.Exec(ctx); err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		fail(w, 401, "invalid_credentials", "账号或密码错误")
		return
	}
	f.issueSession(w, r, account, false)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func publicUser(u *ent.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "nickname": u.Nickname, "status": u.Status, "email": u.Email, "preferences": u.Preferences}
}

func (f *Framework) me(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	cookie, _ := r.Cookie("zenith_session")
	csrfToken := digest("zenith-csrf:" + cookie.Value)
	permissions, err := f.permissions(r.Context(), p)
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	view, err := f.userView(r, p.User)
	if err != nil {
		fail(w, 503, "database_unavailable", "用户资料查询失败")
		return
	}

	respond(w, 200, map[string]any{"user": view, "superAdmin": p.SuperAdmin, "permissions": permissions, "csrfToken": csrfToken})
}

func (f *Framework) logout(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.Session.UpdateOneID(p.Session.ID).SetRevokedAt(time.Now()).Exec(r.Context()); err != nil {
			return err
		}
		return tx.LoginLog.Create().SetUserID(p.User.ID).SetUsername(p.User.Username).SetSuccess(true).SetEventType("logout").SetIP(clientIP(r)).Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "退出失败")
		return
	}
	expireCookie(w, f.config.SecureCookies)
	respond(w, 200, nil)
}
