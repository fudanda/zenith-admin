package arcbase

import (
	"github.com/fudanda/arcbase/backend/internal/storage"
	"github.com/fudanda/arcbase/backend/internal/storage/local"
)

type FileStorage = storage.Provider
type FileRoot = storage.Root

func configuredFileStorage(config Config) storage.Provider {
	if config.FileStorage != nil {
		return config.FileStorage
	}
	return local.Provider{}
}
