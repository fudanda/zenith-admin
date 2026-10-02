package audit

import (
	"context"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/hook"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
)

func InstallMetadataHooks(s *data.Store) {
	s.Client.AuditLog.Use(func(next ent.Mutator) ent.Mutator {
		return hook.AuditLogFunc(func(ctx context.Context, m *ent.AuditLogMutation) (ent.Value, error) {
			if m.Op().Is(ent.OpCreate) {
				if p := kernel.FromContext(ctx); p != nil && p.APIKeyID != 0 {
					m.SetAPIKeyID(p.APIKeyID)
				}
				if meta, ok := kernel.Metadata(ctx); ok {
					module := meta.Module
					if module == "" {
						module, _ = m.Resource()
					}
					description := meta.Description
					if operation, _ := m.Operation(); operation == "api_key_authenticated" {
						description = "API Key 认证成功"
						module = "API Key"
					}
					if description == "" {
						description, _ = m.Operation()
					}
					m.SetModule(module)
					m.SetDescription(description)
					m.SetMethod(meta.Method)
					m.SetPath(meta.Path)
					m.SetIP(meta.IP)
					m.SetUserAgent(meta.UserAgent)
					m.SetBrowser(kernel.BrowserName(meta.UserAgent))
					m.SetOs(kernel.OsName(meta.UserAgent))
					m.SetDurationMs(int(time.Since(meta.Started).Milliseconds()))
					if meta.SuccessStatus != 0 {
						m.SetResponseCode(meta.SuccessStatus)
					}
					operation, _ := m.Operation()
					if meta.Body != "" && operation != "api_key_authenticated" {
						m.SetRequestBody(meta.Body)
					}
				}
			}
			return next.Mutate(ctx, m)
		})
	})
	s.Client.LoginLog.Use(func(next ent.Mutator) ent.Mutator {
		return hook.LoginLogFunc(func(ctx context.Context, m *ent.LoginLogMutation) (ent.Value, error) {
			if m.Op().Is(ent.OpCreate) {
				if meta, ok := kernel.Metadata(ctx); ok {
					m.SetUserAgent(meta.UserAgent)
					m.SetBrowser(kernel.BrowserName(meta.UserAgent))
					m.SetOs(kernel.OsName(meta.UserAgent))
				}
			}
			return next.Mutate(ctx, m)
		})
	})
}
