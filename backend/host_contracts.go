package zenith

import (
	"encoding/json"
	"fmt"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	httptransport "github.com/fudanda/zenith-admin/backend/internal/transport/http"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"net/http"
	"strings"
)

// HostContract is generated from the host's shared operation schema at build time.
// Definitions are instance-local; no global contract map is modified.
type HostContract struct {
	ID                  string `json:"id"`
	Method              string `json:"method"`
	Path                string `json:"path"`
	Permission          string `json:"permission"`
	Body, Query, Params map[string]any
	QueryTypes          map[string]string `json:"queryTypes"`
	AuditModule         string            `json:"auditModule"`
	AuditDescription    string            `json:"auditDescription"`
	AuditRecordBody     bool              `json:"auditRecordBody"`
	SuccessStatus       int               `json:"successStatus"`
}

func RegisterHostContract(reg *Registrar, op HostContract, handler http.Handler) error {
	if !strings.HasPrefix(op.Path, "/api/v1/extensions/") || op.ID == "" || op.Permission == "" {
		return fmt.Errorf("host contract requires an extension path, ID and permission")
	}
	definition := contracts.RequestDefinition{QueryTypes: op.QueryTypes, SuccessStatus: op.SuccessStatus}
	compile := func(name string, value map[string]any) (*jsonschema.Schema, error) {
		if value == nil {
			return nil, nil
		}
		compiler := jsonschema.NewCompiler()
		compiler.AssertFormat()
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		var doc any
		if err = json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		uri := "https://zenith.local/host/" + op.ID + "/" + name
		if err = compiler.AddResource(uri, doc); err != nil {
			return nil, err
		}
		return compiler.Compile(uri)
	}
	var err error
	if definition.Body, err = compile("body", op.Body); err != nil {
		return err
	}
	if definition.Query, err = compile("query", op.Query); err != nil {
		return err
	}
	if definition.Params, err = compile("params", op.Params); err != nil {
		return err
	}
	return reg.Register(Route{Method: op.Method, Path: op.Path, OperationID: op.ID, Permission: op.Permission, Handler: handler,
		AuditModule: op.AuditModule, AuditDescription: op.AuditDescription, AuditRecordBody: op.AuditRecordBody, SuccessStatus: op.SuccessStatus,
		Validate: func(r *http.Request) error { return httptransport.ValidateRequestDefinition(r, definition) },
	})
}
