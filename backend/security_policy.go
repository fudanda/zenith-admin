package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/loginattempt"
	"github.com/fudanda/zenith-admin/backend/ent/session"
)

type securityPolicy struct {
	Password struct {
		MinLength          int  `json:"minLength"`
		RequireUppercase   bool `json:"requireUppercase"`
		RequireSpecialChar bool `json:"requireSpecialChar"`
		ExpiryEnabled      bool `json:"expiryEnabled"`
		ExpiryDays         int  `json:"expiryDays"`
	} `json:"password"`
	LoginChallenge struct {
		MaxAttemptsPerSource int `json:"maxAttemptsPerSource"`
		SourceLimit          int `json:"sourceLimit"`
		WindowMinutes        int `json:"windowMinutes"`
	} `json:"loginChallenge"`
	Session struct {
		MaxSessions  int    `json:"maxSessions"`
		Scope        string `json:"scope"`
		ExceedAction string `json:"exceedAction"`
	} `json:"session"`
}

func (f *Framework) securityPolicy(ctx context.Context) (securityPolicy, error) {
	return f.Store.securityPolicy(ctx)
}

func (s *Store) securityPolicy(ctx context.Context) (securityPolicy, error) {
	value, _, err := s.loadSetting(ctx, "identitySecurity")
	if err != nil {
		return securityPolicy{}, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return securityPolicy{}, err
	}
	var policy securityPolicy
	err = json.Unmarshal(raw, &policy)
	return policy, err
}

var uppercasePassword = regexp.MustCompile(`[A-Z]`)
var specialPassword = regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]`)

func (f *Framework) validatePassword(ctx context.Context, password string) error {
	return f.Store.validatePassword(ctx, password)
}

func (s *Store) validatePassword(ctx context.Context, password string) error {
	policy, err := s.securityPolicy(ctx)
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
func usernameHash(name string) string  { return digest(strings.ToLower(name)) }
func sourceKey(name, ip string) string { return digest(strings.ToLower(name) + ":" + ip) }
func (f *Framework) requiresChallenge(ctx context.Context, name, ip string, policy securityPolicy) (bool, error) {
	rows, err := f.Store.Client.LoginAttempt.Query().Where(loginattempt.UsernameHashEQ(usernameHash(name)), loginattempt.LockedUntilGT(time.Now())).All(ctx)
	if err != nil {
		return false, err
	}
	if len(rows) >= policy.LoginChallenge.SourceLimit {
		return true, nil
	}
	for _, row := range rows {
		if row.Key == sourceKey(name, ip) && row.Failures >= policy.LoginChallenge.MaxAttemptsPerSource {
			return true, nil
		}
	}
	return false, nil
}
func (f *Framework) recordLoginFailure(ctx context.Context, name, ip string, policy securityPolicy) error {
	_, err := f.Store.DB.ExecContext(ctx, `INSERT INTO login_attempts(key,username_hash,failures,locked_until,updated_at) VALUES($1,$2,1,now()+$3*interval '1 minute',now()) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN login_attempts.locked_until>now() THEN login_attempts.failures+1 ELSE 1 END,locked_until=now()+$3*interval '1 minute',updated_at=now()`, sourceKey(name, ip), usernameHash(name), policy.LoginChallenge.WindowMinutes)
	return err
}

var errSessionConflict = errors.New("session concurrency limit reached")

func (f *Framework) issueSession(w http.ResponseWriter, r *http.Request, account *ent.User, replaceAll bool) {
	ctx := r.Context()
	policy, err := f.securityPolicy(ctx)
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	token, err := secret()
	if err != nil {
		fail(w, 500, "random_unavailable", "登录服务不可用")
		return
	}
	csrfToken := digest("zenith-csrf:" + token)
	expires := time.Now().Add(12 * time.Hour)
	var conflicts []*ent.Session
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		// Lock the account row so concurrent logins cannot both occupy the last slot.
		fresh, err := tx.User.UpdateOneID(account.ID).SetUpdatedAt(time.Now()).Save(ctx)
		if err != nil {
			return err
		}
		if fresh.Status != "enabled" || fresh.PasswordHash != account.PasswordHash {
			return errUnauthenticated
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
		if old, e := r.Cookie("zenith_session"); e == nil {
			if _, err = tx.Session.Update().Where(session.TokenHashEQ(digest(old.Value))).SetRevokedAt(time.Now()).Save(ctx); err != nil {
				return err
			}
		}
		if err = tx.Session.Create().SetUserID(account.ID).SetTokenHash(digest(token)).SetCsrfHash(digest(csrfToken)).SetExpiresAt(expires).SetIP(clientIP(r)).SetBrowser(browserName(r.UserAgent())).SetOs(osName(r.UserAgent())).Exec(ctx); err != nil {
			return err
		}
		if _, err = tx.LoginAttempt.Delete().Where(loginattempt.KeyEQ(sourceKey(account.Username, clientIP(r)))).Exec(ctx); err != nil {
			return err
		}
		return tx.LoginLog.Create().SetUserID(account.ID).SetUsername(account.Username).SetSuccess(true).SetIP(clientIP(r)).Exec(ctx)
	})
	if errors.Is(err, errSessionConflict) {
		ticket, e := secret()
		if e != nil {
			fail(w, 500, "random_unavailable", "登录服务不可用")
			return
		}
		until := time.Now().Add(5 * time.Minute)
		if err = f.Store.Client.Session.Create().SetUserID(account.ID).SetTokenHash(digest("ticket:" + ticket)).SetCsrfHash("").SetExpiresAt(until).SetRevokedAt(time.Now()).Exec(ctx); err != nil {
			fail(w, 503, "database_unavailable", "登录服务不可用")
			return
		}
		sessions := make([]map[string]any, 0, len(conflicts))
		for _, row := range conflicts {
			sessions = append(sessions, sessionView(row, &principal{}))
		}
		respond(w, 200, map[string]any{"sessionConflict": true, "ticket": ticket, "maxSessions": policy.Session.MaxSessions, "sessions": sessions, "expiresAt": until.UnixMilli()})
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
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
	view, err := f.userView(authenticated, account)
	if err != nil {
		fail(w, 503, "database_unavailable", "用户资料查询失败")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "zenith_session", Value: token, Path: "/", HttpOnly: true, Secure: f.config.SecureCookies, SameSite: http.SameSiteLaxMode, Expires: expires})
	respond(w, 200, map[string]any{"user": view, "csrfToken": csrfToken, "superAdmin": p.SuperAdmin, "permissions": permissions})
}
func (f *Framework) resolveSessionConflict(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		fail(w, 403, "origin_invalid", "请求来源不合法")
		return
	}
	var in struct {
		Ticket string `json:"ticket"`
	}
	if err := decode(r, &in); err != nil || len(in.Ticket) != 64 {
		fail(w, 400, "invalid_ticket", "登录票据无效")
		return
	}
	row, err := f.Store.Client.Session.Query().Where(session.TokenHashEQ(digest("ticket:"+in.Ticket)), session.ExpiresAtGT(time.Now())).Only(r.Context())
	if err != nil {
		fail(w, 400, "invalid_ticket", "登录票据已过期")
		return
	}
	count, err := f.Store.Client.Session.Update().Where(session.IDEQ(row.ID), session.ExpiresAtGT(time.Now())).SetExpiresAt(time.Now()).Save(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "登录服务不可用")
		return
	}
	if count != 1 {
		fail(w, 400, "invalid_ticket", "登录票据已使用")
		return
	}
	account, err := f.Store.Client.User.Get(r.Context(), row.UserID)
	if err != nil || account.Status != "enabled" || account.PasswordUpdatedAt.After(row.CreatedAt) {
		fail(w, 401, "invalid_credentials", "账号状态已变更，请重新登录")
		return
	}
	f.issueSession(w, r, account, true)
}
