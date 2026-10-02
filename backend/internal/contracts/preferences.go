package contracts

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed preference-overrides.json
var preferenceSchemaJSON []byte

//go:embed preference-policy.json
var PreferencePolicy json.RawMessage

var preferenceValidator = sync.OnceValues(func() (*jsonschema.Schema, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(preferenceSchemaJSON))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	const name = "urn:arcbase:preference-overrides"
	if err := c.AddResource(name, doc); err != nil {
		return nil, err
	}
	return c.Compile(name)
})

func ValidatePreferences(value map[string]any) error {
	schema, err := preferenceValidator()
	if err != nil {
		return err
	}
	return schema.Validate(value)
}
