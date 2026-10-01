package zenith

import (
	"github.com/fudanda/zenith-admin/backend/internal/storage"
	"github.com/fudanda/zenith-admin/backend/internal/storage/local"
)

type FileStorage = storage.Provider
type FileRoot = storage.Root

func (f *Framework) fileStorage() storage.Provider {
	if f.config.FileStorage != nil {
		return f.config.FileStorage
	}
	return local.Provider{}
}
