package zenith

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/hook"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
)

type requestMetadata struct {
	Method, Path, IP, UserAgent, Body, Module, Description string
	Started                                                time.Time
	SuccessStatus                                          int
}
type metadataKey struct{}

func redactAudit(value any) any {
	switch node := value.(type) {
	case map[string]any:
		for key, item := range node {
			secret := false
			for _, word := range []string{"password", "token", "cookie", "secret", "ticket", "authorization", "captcha"} {
				if strings.Contains(strings.ToLower(key), word) {
					secret = true
					break
				}
			}
			if secret {
				delete(node, key)
			} else {
				node[key] = redactAudit(item)
			}
		}
		return node
	case []any:
		for i, item := range node {
			node[i] = redactAudit(item)
		}
		return node
	default:
		return value
	}
}
func withRequestMetadata(w http.ResponseWriter, r *http.Request, route Route) (*http.Request, error) {
	meta := requestMetadata{Method: r.Method, Path: r.URL.Path, IP: clientIP(r), UserAgent: r.UserAgent(), Started: time.Now()}
	if op, ok := contracts.Operations[route.OperationID]; ok {
		meta.Module = op.AuditModule
		meta.Description = op.AuditDescription
	}
	if definition, ok := contracts.RequestDefinitions[route.OperationID]; ok {
		meta.SuccessStatus = definition.SuccessStatus
	}
	if r.Body != nil && strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
		if err != nil {
			return nil, err
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		var value any
		if json.Unmarshal(raw, &value) == nil {
			filtered, err := json.Marshal(redactAudit(value))
			if err != nil {
				return nil, err
			}
			meta.Body = string(filtered)
		}
	}
	return r.WithContext(context.WithValue(r.Context(), metadataKey{}, meta)), nil
}
func (s *Store) installAuditHooks() {
	s.Client.AuditLog.Use(func(next ent.Mutator) ent.Mutator {
		return hook.AuditLogFunc(func(ctx context.Context, m *ent.AuditLogMutation) (ent.Value, error) {
			if m.Op().Is(ent.OpCreate) {
				if meta, ok := ctx.Value(metadataKey{}).(requestMetadata); ok {
					module := meta.Module
					if module == "" {
						module, _ = m.Resource()
					}
					description := meta.Description
					if description == "" {
						description, _ = m.Operation()
					}
					m.SetModule(module)
					m.SetDescription(description)
					m.SetMethod(meta.Method)
					m.SetPath(meta.Path)
					m.SetIP(meta.IP)
					m.SetUserAgent(meta.UserAgent)
					m.SetBrowser(browserName(meta.UserAgent))
					m.SetOs(osName(meta.UserAgent))
					m.SetDurationMs(int(time.Since(meta.Started).Milliseconds()))
					if meta.SuccessStatus != 0 {
						m.SetResponseCode(meta.SuccessStatus)
					}
					if meta.Body != "" {
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
				if meta, ok := ctx.Value(metadataKey{}).(requestMetadata); ok {
					m.SetUserAgent(meta.UserAgent)
					m.SetBrowser(browserName(meta.UserAgent))
					m.SetOs(osName(meta.UserAgent))
				}
			}
			return next.Mutate(ctx, m)
		})
	})
}
