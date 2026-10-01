package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/security"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Handler struct {
	service *Service
	mcp     http.Handler
}

func NewHandler(service *Service) *Handler {
	h := &Handler{service: service}
	h.mcp = mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		server := mcp.NewServer(&mcp.Implementation{Name: "zenith-readonly", Version: "1.0.0"}, nil)
		tools, err := service.Tools(r.Context(), kernel.FromContext(r.Context()))
		if err != nil {
			return nil
		}
		for _, tool := range tools {
			mcp.AddTool(server, &mcp.Tool{Name: tool.Name, Description: tool.Description, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true}}, func(ctx context.Context, _ *mcp.CallToolRequest, args queryArgs) (*mcp.CallToolResult, any, error) {
				if args.Page == 0 {
					args.Page = 1
				}
				if args.PageSize == 0 {
					args.PageSize = 20
				}
				result, err := service.Read(ctx, tool, args.Page, args.PageSize, args.Keyword)
				if err != nil {
					return nil, nil, err
				}
				return nil, result.Data, nil
			})
		}
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	return h
}

type queryArgs struct {
	Page     int    `json:"page,omitempty"`
	PageSize int    `json:"pageSize,omitempty"`
	Keyword  string `json:"keyword,omitempty"`
}

func (h *Handler) MCP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "" && !httptransport.SameOrigin(r) {
		httptransport.Fail(w, 403, "origin_invalid", "请求来源无效")
		return
	}
	if err := h.service.AuditMCP(r.Context(), "readonly"); err != nil {
		httptransport.Fail(w, 503, "database_unavailable", "审计不可用")
		return
	}
	h.mcp.ServeHTTP(w, r)
}
func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "" && !httptransport.SameOrigin(r) {
		httptransport.Fail(w, 403, "origin_invalid", "请求来源无效")
		return
	}
	cursor := -1
	raw := r.Header.Get("Last-Event-ID")
	if raw == "" {
		raw = r.URL.Query().Get("cursor")
	}
	if raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			httptransport.Fail(w, 400, "invalid_cursor", "订阅游标无效")
			return
		}
		cursor = value
	}
	p := kernel.FromContext(r.Context())
	latest, _, err := h.service.Changes(r.Context(), p, -1)
	if err != nil {
		httptransport.Fail(w, 503, "database_unavailable", "订阅不可用")
		return
	}
	if cursor == -1 {
		cursor = latest
	}
	flush, ok := w.(http.Flusher)
	if !ok {
		httptransport.Fail(w, 500, "stream_unavailable", "不支持流式响应")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	emit := func(event string, data any) bool {
		value, _ := json.Marshal(data)
		_, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", cursor, event, value)
		flush.Flush()
		return err == nil
	}
	if !emit("ready", map[string]any{"requery": true}) {
		return
	}
	key := strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
	token := ""
	if key {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	} else if cookie, e := r.Cookie("zenith_session"); e == nil {
		token = cookie.Value
	}
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.service.Stopped():
			return
		case <-timer.C:
			current, err := h.service.Authenticate(r.Context(), token, key)
			if err != nil {
				if errors.Is(err, kernel.ErrUnauthenticated) {
					emit("session-expired", map[string]any{})
				} else {
					emit("unavailable", map[string]any{"retry": true})
				}
				return
			}
			ctx := security.WithPrincipal(r.Context(), current)
			next, resources, err := h.service.Changes(ctx, current, cursor)
			if err != nil {
				emit("unavailable", map[string]any{"retry": true})
				return
			}
			cursor = next
			if len(resources) > 0 {
				if !emit("change", map[string]any{"resources": resources}) {
					return
				}
			} else {
				if !emit("cursor", map[string]any{}) {
					return
				}
			}
		}
	}
}
