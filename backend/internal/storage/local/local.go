package local

import (
	"github.com/fudanda/arcbase/backend/internal/storage"
	"os"
)

type Provider struct{}
type root struct{ *os.Root }

func (Provider) OpenRoot(path string) (storage.Root, error) {
	r, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	return root{r}, nil
}

func (r root) OpenRoot(path string) (storage.Root, error) {
	nested, err := r.Root.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	return root{nested}, nil
}

var _ storage.Provider = Provider{}
