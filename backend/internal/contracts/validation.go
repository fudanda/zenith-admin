package contracts

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed openapi.json
var openAPIJSON []byte

type RequestDefinition struct {
	Body          *jsonschema.Schema
	Query         *jsonschema.Schema
	Params        *jsonschema.Schema
	Response      *jsonschema.Schema
	SuccessStatus int
	QueryTypes    map[string]string
}

var RequestDefinitions = map[string]RequestDefinition{}

type pathPattern struct {
	original string
	simple   *regexp.Regexp
}

func (p pathPattern) String() string { return p.original }
func (p pathPattern) MatchString(value string) bool {
	return !strings.HasPrefix(value, "//") && p.simple.MatchString(value)
}
func contractRegexp(pattern string) (jsonschema.Regexp, error) {
	if pattern == "^\\/(?!\\/)[^\\s\\\\]*$" {
		r, err := regexp.Compile("^/[^\\s\\\\]*$")
		return pathPattern{pattern, r}, err
	}
	return regexp.Compile(pattern)
}

// OpenAPI 3.0 nullable/exclusive bounds are converted to JSON Schema, while
// references still point to the same generated components. No hand-written DTO
// schema participates in request validation.
func jsonSchemaValue(value any) any {
	switch node := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for key, item := range node {
			if key != "nullable" {
				result[key] = jsonSchemaValue(item)
			}
		}
		for _, bound := range []string{"Minimum", "Maximum"} {
			key := "exclusive" + bound
			if enabled, ok := result[key].(bool); ok {
				delete(result, key)
				if enabled {
					lower := strings.ToLower(bound[:1]) + bound[1:]
					result[key] = result[lower]
					delete(result, lower)
				}
			}
		}
		if node["nullable"] == true {
			return map[string]any{"anyOf": []any{result, map[string]any{"type": "null"}}}
		}
		return result
	case []any:
		list := make([]any, len(node))
		for i, item := range node {
			list[i] = jsonSchemaValue(item)
		}
		return list
	default:
		return value
	}
}
func init() {
	var document map[string]any
	if err := json.Unmarshal(openAPIJSON, &document); err != nil {
		panic(err)
	}
	components := jsonSchemaValue(document["components"])
	paths := document["paths"].(map[string]any)
	for _, methods := range paths {
		for _, entry := range methods.(map[string]any) {
			operation, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			id, _ := operation["operationId"].(string)
			if id == "" {
				continue
			}
			definition := RequestDefinition{QueryTypes: map[string]string{}}
			compile := func(name string, schema any) *jsonschema.Schema {
				root := map[string]any{"components": components, "allOf": []any{jsonSchemaValue(schema)}}
				compiler := jsonschema.NewCompiler()
				compiler.UseRegexpEngine(contractRegexp)
				compiler.AssertFormat()
				uri := "urn:arcbase:request:" + id + ":" + name
				if err := compiler.AddResource(uri, root); err != nil {
					panic(err)
				}
				result, err := compiler.Compile(uri)
				if err != nil {
					panic(fmt.Errorf("%s: %w", uri, err))
				}
				return result
			}
			if body, ok := operation["requestBody"].(map[string]any); ok {
				content := body["content"].(map[string]any)
				if media, ok := content["application/json"].(map[string]any); ok {
					definition.Body = compile("body", media["schema"])
				}
			}
			if responses, ok := operation["responses"].(map[string]any); ok {
				for _, status := range []string{"200", "201"} {
					if response, ok := responses[status].(map[string]any); ok {
						definition.SuccessStatus, _ = strconv.Atoi(status)
						if content, ok := response["content"].(map[string]any); ok {
							if media, ok := content["application/json"].(map[string]any); ok {
								definition.Response = compile("response", media["schema"])
							}
						}
					}
				}
			}
			for _, location := range []string{"query", "path"} {
				properties := map[string]any{}
				required := []any{}
				if parameters, ok := operation["parameters"].([]any); ok {
					for _, item := range parameters {
						parameter := item.(map[string]any)
						if parameter["in"] != location {
							continue
						}
						name := parameter["name"].(string)
						schema := parameter["schema"].(map[string]any)
						properties[name] = schema
						if parameter["required"] == true {
							required = append(required, name)
						}
						if location == "query" {
							definition.QueryTypes[name], _ = schema["type"].(string)
						}
					}
				}
				if len(properties) > 0 {
					schema := map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
					validator := compile(location, schema)
					if location == "query" {
						definition.Query = validator
					} else {
						definition.Params = validator
					}
				}
			}
			RequestDefinitions[id] = definition
		}
	}
}
