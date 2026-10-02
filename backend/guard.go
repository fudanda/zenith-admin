package arcbase

import (
	"net/http"

	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

func (f *Framework) guard(route Route) http.Handler {
	return (&httptransport.Guard{Authenticate: f.services.identity.Authenticate, AuthenticateKey: f.services.identity.AuthenticateKey, Permitted: f.services.authorization.Permitted, SecureCookies: f.config.SecureCookies}).Wrap(route)
}
