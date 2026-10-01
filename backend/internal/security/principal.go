// Package security defines business identity independently of HTTP.
package security

import (
	"context"
	"github.com/fudanda/zenith-admin/backend/ent"
)

type Principal struct {
	User                   *ent.User
	Session                *ent.Session
	SuperAdmin             bool
	PasswordChangeRequired bool
	APIKeyID               int
	KeyPermissions         []string
}

func (p *Principal) KeyAllows(permission string) bool {
	if p.APIKeyID == 0 {
		return true
	}
	for _, granted := range p.KeyPermissions {
		if granted == permission {
			return true
		}
	}
	return false
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func FromContext(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

// Actor is explicitly passed to transactional writes and auditing.
type Actor struct {
	UserID    int
	RequestID string
}
