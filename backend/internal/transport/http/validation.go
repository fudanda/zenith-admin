package httptransport

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/gorilla/mux"
)

func ValidateContractRequest(r *http.Request, id string) error {
	definition, ok := contracts.RequestDefinitions[id]
	if !ok {
		return nil
	}
	return ValidateRequestDefinition(r, definition)
}

func ValidateRequestDefinition(r *http.Request, definition contracts.RequestDefinition) error {
	if definition.Query != nil {
		value := map[string]any{}
		for key, items := range r.URL.Query() {
			if len(items) != 1 && definition.QueryTypes[key] != "array" {
				return errors.New("查询参数重复")
			}
			raw := items[0]
			var item any = raw
			switch definition.QueryTypes[key] {
			case "integer":
				if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
					item = parsed
				}
			case "number":
				if parsed, err := strconv.ParseFloat(raw, 64); err == nil {
					item = parsed
				}
			case "boolean":
				if parsed, err := strconv.ParseBool(raw); err == nil {
					item = parsed
				}
			case "array":
				item = items
			}
			value[key] = item
		}
		if err := definition.Query.Validate(value); err != nil {
			return errors.New("查询参数不符合接口契约")
		}
	}
	if definition.Params != nil {
		value := map[string]any{}
		for key, raw := range mux.Vars(r) {
			var item any = raw
			if key == "id" || key == "itemId" || key == "configId" {
				if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
					item = parsed
				}
			}
			value[key] = item
		}
		if err := definition.Params.Validate(value); err != nil {
			return errors.New("路径参数不符合接口契约")
		}
	}
	if definition.Body != nil && !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			return errors.New("需要 JSON 请求体")
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			return err
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		var value any
		if err = json.Unmarshal(raw, &value); err != nil {
			return errors.New("JSON 请求体无效")
		}
		if err = definition.Body.Validate(value); err != nil {
			return errors.New("请求体不符合接口契约")
		}
	}
	return nil
}
