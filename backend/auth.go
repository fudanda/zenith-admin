package zenith

import (
	"context"
	"crypto/subtle"
	"database/sql"
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
	"github.com/fudanda/zenith-admin/backend/ent/tenant"
	"github.com/fudanda/zenith-admin/backend/ent/tenantpackagefeature"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/usergroupmember"
	"github.com/fudanda/zenith-admin/backend/ent/usergrouprole"
	"github.com/fudanda/zenith-admin/backend/ent/usermenu"
	"github.com/fudanda/zenith-admin/backend/ent/userrole"
	"golang.org/x/crypto/bcrypt"
)

var errUnauthenticated = errors.New("authentication required")

type principal struct {
	User       *ent.User
	Session    *ent.Session
	SuperAdmin bool
	TenantID   *int
}
type principalKey struct{}

func fromContext(ctx context.Context) *principal {
	p, _ := ctx.Value(principalKey{}).(*principal)
	return p
}

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
	if u.TenantID != nil {
		t, err := f.Store.Client.Tenant.Get(ctx, *u.TenantID)
		if ent.IsNotFound(err) {
			return nil, errUnauthenticated
		}
		if err != nil {
			return nil, err
		}
		if t.Status != "enabled" {
			return nil, errUnauthenticated
		}
	}
	p := &principal{User: u, Session: sess, TenantID: u.TenantID}
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
		if roleRow.Status == "enabled" && roleRow.Code == "super_admin" && roleRow.TenantID == nil && u.TenantID == nil {
			p.SuperAdmin = true
		}
	}
	if p.SuperAdmin && sess.TenantViewID != nil {
		t, err := f.Store.Client.Tenant.Query().Where(tenant.IDEQ(*sess.TenantViewID), tenant.StatusEQ("enabled")).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, errUnauthenticated
		}
		if err != nil {
			return nil, err
		}
		p.TenantID = &t.ID
	}
	return p, nil
}

func (f *Framework) effectiveRoleIDs(ctx context.Context, userID int) ([]int, error) {
	account, err := f.Store.Client.User.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
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
		if (account.TenantID == nil) != (group.TenantID == nil) {
			continue
		}
		if account.TenantID != nil && *account.TenantID != *group.TenantID {
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
			row, err := f.Store.Client.Role.Query().Where(role.IDEQ(id), role.StatusEQ("enabled")).Only(ctx)
			if ent.IsNotFound(err) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if (row.TenantID == nil) != (p.User.TenantID == nil) || row.TenantID != nil && *row.TenantID != *p.User.TenantID {
				continue
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
	if p.User.TenantID == nil {
		return rows, nil
	}
	t, err := f.Store.Client.Tenant.Get(ctx, *p.User.TenantID)
	if err != nil {
		return nil, err
	}
	if t.PackageID == nil {
		return rows, nil
	}
	pkg, err := f.Store.Client.TenantPackage.Get(ctx, *t.PackageID)
	if err != nil {
		return nil, err
	}
	features := map[string]bool{}
	if pkg.Status == "enabled" {
		links, err := f.Store.Client.TenantPackageFeature.Query().Where(tenantpackagefeature.PackageIDEQ(pkg.ID)).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, link := range links {
			features[link.FeatureKey] = true
		}
	}
	filtered := make([]*ent.Menu, 0, len(rows))
	for _, row := range rows {
		if row.FeatureKey == nil || features[*row.FeatureKey] {
			filtered = append(filtered, row)
		}
	}
	return filtered, nil
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
		if route.Public {
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
		if route.Permission == "platform" && !p.SuperAdmin {
			fail(w, 403, "forbidden", "需要平台管理员权限")
			return
		}
		if route.Permission != "authenticated" && route.Permission != "platform" {
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
		route.Handler.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
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

func (f *Framework) captcha(w http.ResponseWriter, r *http.Request) {
	id, err := secret()
	if err != nil {
		fail(w, 500, "random_unavailable", "验证码不可用")
		return
	}
	answerSecret, err := secret()
	if err != nil {
		fail(w, 500, "random_unavailable", "验证码不可用")
		return
	}
	answer := strings.ToUpper(answerSecret[:6])
	if _, err = f.Store.Client.Captcha.Create().SetPublicID(id).SetAnswerHash(digest(answer)).SetExpiresAt(time.Now().Add(5 * time.Minute)).Save(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "验证码不可用")
		return
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" fill="#eef2ff"/><text x="15" y="33" font-family="monospace" font-size="25" letter-spacing="4" fill="#242a50">%s</text></svg>`, html.EscapeString(answer))
	respond(w, 200, map[string]string{"captchaId": id, "image": "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))})
}

type loginInput struct {
	Username      string `json:"username"`
	Password      string `json:"password"`
	TenantCode    string `json:"tenantCode"`
	CaptchaID     string `json:"captchaId"`
	CaptchaAnswer string `json:"captchaAnswer"`
}

func (f *Framework) login(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		fail(w, 403, "origin_invalid", "请求来源不合法")
		return
	}
	var in loginInput
	if err := decode(r, &in); err != nil || in.Username == "" || in.Password == "" || in.CaptchaID == "" || in.CaptchaAnswer == "" {
		fail(w, 400, "invalid_request", "登录参数不完整")
		return
	}
	ctx := r.Context()
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
	updated, err := f.Store.Client.Captcha.Update().Where(captcha.IDEQ(challenge.ID), captcha.UsedAtIsNil()).SetUsedAt(time.Now()).Save(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	if updated != 1 {
		fail(w, 400, "captcha_invalid", "验证码已使用")
		return
	}
	if subtle.ConstantTimeCompare([]byte(challenge.AnswerHash), []byte(digest(strings.ToUpper(strings.TrimSpace(in.CaptchaAnswer))))) != 1 {
		fail(w, 400, "captcha_invalid", "验证码无效")
		return
	}
	key := digest(strings.ToLower(in.TenantCode + ":" + in.Username))
	var failures int
	var locked *time.Time
	err = f.Store.DB.QueryRowContext(ctx, `SELECT failures, locked_until FROM login_attempts WHERE key=$1`, key).Scan(&failures, &locked)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	if locked != nil && locked.After(time.Now()) {
		fail(w, 429, "login_locked", "登录尝试过多，请稍后再试")
		return
	}
	query := f.Store.Client.User.Query().Where(user.UsernameEQ(in.Username), user.StatusEQ("enabled"))
	if in.TenantCode == "" {
		query = query.Where(user.TenantIDIsNil())
	} else {
		t, err := f.Store.Client.Tenant.Query().Where(tenant.CodeEQ(in.TenantCode), tenant.StatusEQ("enabled")).Only(ctx)
		if err == nil {
			query = query.Where(user.TenantIDEQ(t.ID))
		} else if ent.IsNotFound(err) {
			query = query.Where(user.IDEQ(-1))
		} else {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
	}
	u, err := query.Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	valid := err == nil && bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) == nil
	if !valid {
		_, dbErr := f.Store.DB.ExecContext(ctx, `INSERT INTO login_attempts (key, failures, locked_until, updated_at) VALUES ($1,1,NULL,now()) ON CONFLICT (key) DO UPDATE SET failures=login_attempts.failures+1, locked_until=CASE WHEN login_attempts.failures+1>=5 THEN now()+interval '15 minutes' ELSE NULL END, updated_at=now()`, key)
		if dbErr != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		log := f.Store.Client.LoginLog.Create().SetUsername(in.Username).SetSuccess(false).SetReason("invalid_credentials").SetIP(clientIP(r))
		if u != nil {
			log.SetUserID(u.ID)
			if u.TenantID != nil {
				log.SetTenantID(*u.TenantID)
			}
		}
		if err := log.Exec(ctx); err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		fail(w, 401, "invalid_credentials", "账号或密码错误")
		return
	}
	token, err := secret()
	if err != nil {
		fail(w, 500, "random_unavailable", "登录服务不可用")
		return
	}
	csrfToken := digest("zenith-csrf:" + token)
	expires := time.Now().Add(12 * time.Hour)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if old, e := r.Cookie("zenith_session"); e == nil {
			if _, err := tx.Session.Update().Where(session.TokenHashEQ(digest(old.Value))).SetRevokedAt(time.Now()).Save(ctx); err != nil {
				return err
			}
		}
		if err := tx.Session.Create().SetUserID(u.ID).SetTokenHash(digest(token)).SetCsrfHash(digest(csrfToken)).SetExpiresAt(expires).Exec(ctx); err != nil {
			return err
		}
		log := tx.LoginLog.Create().SetUsername(u.Username).SetUserID(u.ID).SetSuccess(true).SetIP(clientIP(r))
		if u.TenantID != nil {
			log.SetTenantID(*u.TenantID)
		}
		return log.Exec(ctx)
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	_, _ = f.Store.DB.ExecContext(ctx, `DELETE FROM login_attempts WHERE key=$1`, key)
	authenticated := r.Clone(ctx)
	authenticated.Header.Set("Cookie", "zenith_session="+token)
	p, err := f.principal(ctx, authenticated)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	permissions, err := f.permissions(ctx, p)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "zenith_session", Value: token, Path: "/", HttpOnly: true, Secure: f.config.SecureCookies, SameSite: http.SameSiteLaxMode, Expires: expires})
	respond(w, 200, map[string]any{"user": publicUser(u), "csrfToken": csrfToken, "tenantViewId": p.TenantID, "superAdmin": p.SuperAdmin, "permissions": permissions})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func publicUser(u *ent.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "nickname": u.Nickname, "tenantId": u.TenantID, "status": u.Status, "email": u.Email, "preferences": u.Preferences}
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
	respond(w, 200, map[string]any{"user": publicUser(p.User), "tenantViewId": p.TenantID, "superAdmin": p.SuperAdmin, "permissions": permissions, "csrfToken": csrfToken})
}

func (f *Framework) logout(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	if err := f.Store.Client.Session.UpdateOneID(p.Session.ID).SetRevokedAt(time.Now()).Exec(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "退出失败")
		return
	}
	expireCookie(w, f.config.SecureCookies)
	respond(w, 200, nil)
}
