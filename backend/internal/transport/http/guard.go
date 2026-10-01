package httptransport

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/security"
)

type Guard struct {
	Authenticate    func(context.Context, string) (*security.Principal, error)
	AuthenticateKey func(context.Context, string) (*security.Principal, error)
	Permitted       func(context.Context, *security.Principal, string) (bool, error)
	SecureCookies   bool
}

func sessionToken(r *http.Request) string {
	cookie, err := r.Cookie("zenith_session")
	if err != nil {
		return ""
	}
	return cookie.Value
}
func (f *Guard) Wrap(route Route) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = SecureCookieContext(r, f.SecureCookies)
		var err error
		r, err = withMetadata(w, r, route)
		if err != nil {
			Fail(w, 413, "invalid_request", "请求内容过大或无效")
			return
		}
		if route.Public {
			if err := ValidateContractRequest(r, route.OperationID); err != nil {
				Fail(w, 400, "invalid_request", err.Error())
				return
			}
			if route.Validate != nil {
				if err := route.Validate(r); err != nil {
					Fail(w, 400, "invalid_request", err.Error())
					return
				}
			}
			route.Handler.ServeHTTP(w, r)
			return
		}
		var p *security.Principal
		if header := r.Header.Get("Authorization"); header != "" {
			if !strings.HasPrefix(header, "Bearer ") || f.AuthenticateKey == nil {
				Fail(w, 401, "unauthorized", "API Key 无效")
				return
			}
			p, err = f.AuthenticateKey(r.Context(), strings.TrimPrefix(header, "Bearer "))
		} else {
			p, err = f.Authenticate(r.Context(), sessionToken(r))
		}
		if errors.Is(err, kernel.ErrUnauthenticated) {
			Fail(w, 401, "unauthorized", "请重新登录")
			return
		}
		if err != nil {
			Fail(w, 503, "database_unavailable", "认证服务不可用")
			return
		}
		if p.APIKeyID != 0 && !route.APIKeyAllowed {
			Fail(w, 403, "key_route_denied", "此接口需要浏览器会话")
			return
		}
		if p.APIKeyID != 0 && route.APIKeyPermission != "" {
			allowed, err := f.Permitted(r.Context(), p, route.APIKeyPermission)
			if err != nil {
				Fail(w, 503, "database_unavailable", "授权服务不可用")
				return
			}
			if !allowed {
				Fail(w, 403, "key_scope_denied", "API Key 没有此权限")
				return
			}
		}
		if p.APIKeyID == 0 && r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			value := r.Header.Get("X-CSRF-Token")
			if len(value) != 64 || subtle.ConstantTimeCompare([]byte(kernel.Digest(value)), []byte(p.Session.CsrfHash)) != 1 {
				Fail(w, 403, "csrf_invalid", "CSRF 校验失败")
				return
			}
		}
		if p.PasswordChangeRequired && r.Method != http.MethodGet && route.OperationID != "authChangePassword" && route.OperationID != "authLogout" {
			Fail(w, 403, "password_expired", "密码已过期，请先在个人中心修改密码")
			return
		}
		if (route.Permission == "super_admin" || route.SuperAdminOnly) && !p.SuperAdmin {
			Fail(w, 403, "forbidden", "需要系统管理员权限")
			return
		}
		if route.Permission != "authenticated" && route.Permission != "super_admin" {
			allowed, err := f.Permitted(r.Context(), p, route.Permission)
			if err != nil {
				Fail(w, 503, "database_unavailable", "授权服务不可用")
				return
			}
			if !allowed {
				Fail(w, 403, "forbidden", "没有操作权限")
				return
			}
		}
		if len(route.AnyPermissions) > 0 && (!p.SuperAdmin || p.APIKeyID != 0) {
			allowed := false
			for _, candidate := range route.AnyPermissions {
				ok, err := f.Permitted(r.Context(), p, candidate)
				if err != nil {
					Fail(w, 503, "database_unavailable", "授权服务不可用")
					return
				}
				if ok {
					allowed = true
					break
				}
			}
			if !allowed {
				Fail(w, 403, "forbidden", "没有操作权限")
				return
			}
		}
		if err := ValidateContractRequest(r, route.OperationID); err != nil {
			Fail(w, 400, "invalid_request", err.Error())
			return
		}
		if route.Validate != nil {
			if err := route.Validate(r); err != nil {
				Fail(w, 400, "invalid_request", err.Error())
				return
			}
		}
		route.Handler.ServeHTTP(w, r.WithContext(security.WithPrincipal(r.Context(), p)))
	})
}
