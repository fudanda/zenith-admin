package contracts

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed settings.json
var settingsJSON []byte

type SettingDefinition struct {
	Defaults                                                  map[string]any `json:"defaults"`
	Schema                                                    map[string]any `json:"schema"`
	Title, Description, Path, ReadPermission, WritePermission string
	Page                                                      *string
}

var Settings map[string]SettingDefinition
var settingValidators = map[string]*jsonschema.Schema{}

func init() {
	if err := json.Unmarshal(settingsJSON, &Settings); err != nil {
		panic(err)
	}
	for key, def := range Settings {
		encoded, err := json.Marshal(def.Schema)
		if err != nil {
			panic(err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(encoded))
		if err != nil {
			panic(err)
		}
		c := jsonschema.NewCompiler()
		name := "urn:arcbase:settings:" + key
		if err = c.AddResource(name, doc); err != nil {
			panic(err)
		}
		validator, err := c.Compile(name)
		if err != nil {
			panic(err)
		}
		settingValidators[key] = validator
	}
}
func ValidateSetting(module string, value map[string]any) error {
	validator := settingValidators[module]
	if validator == nil {
		return fmt.Errorf("unsupported settings module")
	}
	return validator.Validate(value)
}
