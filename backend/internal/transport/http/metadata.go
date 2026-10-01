package httptransport

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
)

func withMetadata(w http.ResponseWriter, r *http.Request, route Route) (*http.Request, error) {
	meta := kernel.RequestMetadata{Method: r.Method, Path: r.URL.Path, IP: ClientIP(r), UserAgent: r.UserAgent(), Started: time.Now()}
	recordBody := true
	if op, ok := contracts.Operations[route.OperationID]; ok {
		meta.Module = op.AuditModule
		meta.Description = op.AuditDescription
		recordBody = op.AuditRecordBody
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
		if recordBody && json.Unmarshal(raw, &value) == nil {
			filtered, err := json.Marshal(kernel.RedactAudit(value))
			if err != nil {
				return nil, err
			}
			meta.Body = string(filtered)
		}
	}
	return r.WithContext(kernel.WithMetadata(r.Context(), meta)), nil
}
