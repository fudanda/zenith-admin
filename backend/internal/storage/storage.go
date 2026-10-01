// Package storage defines the local file boundary used by upload and maintenance.
package storage

import "os"

type Provider interface{ OpenRoot(string) (Root, error) }

// Root preserves os.Root's confinement guarantees, including nested chunk roots.
type Root interface {
	Close() error
	Open(string) (*os.File, error)
	OpenFile(string, int, os.FileMode) (*os.File, error)
	OpenRoot(string) (Root, error)
	MkdirAll(string, os.FileMode) error
	Remove(string) error
	RemoveAll(string) error
	Rename(string, string) error
	Link(string, string) error
	Stat(string) (os.FileInfo, error)
}
