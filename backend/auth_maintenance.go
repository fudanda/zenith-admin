package zenith

import (
	"context"
	"errors"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/captcha"
	"github.com/fudanda/zenith-admin/backend/ent/loginattempt"
	"github.com/fudanda/zenith-admin/backend/ent/session"
)

func (s *Store) cleanupAuthentication(ctx context.Context, now time.Time) error {
	_, challenges := s.Client.Captcha.Delete().Where(captcha.Or(captcha.ExpiresAtLT(now), captcha.UsedAtNotNil())).Exec(ctx)
	_, sessions := s.Client.Session.Delete().Where(session.Or(session.ExpiresAtLT(now), session.RevokedAtLT(now.Add(-7*24*time.Hour)))).Exec(ctx)
	_, attempts := s.Client.LoginAttempt.Delete().Where(loginattempt.UpdatedAtLT(now.Add(-24 * time.Hour))).Exec(ctx)
	return errors.Join(challenges, sessions, attempts)
}
