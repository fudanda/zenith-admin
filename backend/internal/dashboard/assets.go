// Package dashboard contains the original Zenith Web production build.
package dashboard

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

func Assets() fs.FS {
	assets, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err)
	}
	return assets
}
