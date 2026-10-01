package contracts

import (
	_ "embed"
	"encoding/json"
)

//go:embed storage-defaults.json
var storageDefaultsJSON []byte
var StorageDefaults struct{ PresignedExpirySeconds int }

func init() {
	if err := json.Unmarshal(storageDefaultsJSON, &StorageDefaults); err != nil {
		panic(err)
	}
}
