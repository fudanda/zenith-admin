package kernel

import (
	"context"
	"strings"
	"time"
)

type RequestMetadata struct {
	Method, Path, IP, UserAgent, Body, Module, Description string
	Started                                                time.Time
	SuccessStatus                                          int
}
type metadataKey struct{}

func WithMetadata(ctx context.Context, metadata RequestMetadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, metadata)
}
func Metadata(ctx context.Context) (RequestMetadata, bool) {
	m, ok := ctx.Value(metadataKey{}).(RequestMetadata)
	return m, ok
}
func RedactAudit(value any) any {
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
				node[key] = RedactAudit(item)
			}
		}
	case []any:
		for i, item := range node {
			node[i] = RedactAudit(item)
		}
	}
	return value
}
