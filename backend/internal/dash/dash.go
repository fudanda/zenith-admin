package dash

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var assets embed.FS

func Handler() http.Handler {
	root, _ := fs.Sub(assets, "dist")
	files := http.FileServer(http.FS(root))
	index, _ := fs.ReadFile(root, "index.html")
	serveIndex := func(w http.ResponseWriter) {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/dash" {
			// GoFr normalizes /dash/ to /dash before dispatching the request.
			// Serve the SPA entry at both spellings to avoid a redirect loop.
			serveIndex(w)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/dash/")
		if name == "" {
			name = "index.html"
		}
		name = path.Clean(name)
		if name == "." || strings.HasPrefix(name, "../") {
			http.NotFound(w, r)
			return
		}
		if _, err := fs.Stat(root, name); err == nil {
			if name == "index.html" {
				serveIndex(w)
				return
			} else {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			r.URL.Path = "/" + name
			files.ServeHTTP(w, r)
			return
		}
		if strings.Contains(path.Base(name), ".") || !strings.Contains(r.Header.Get("Accept"), "text/html") {
			http.NotFound(w, r)
			return
		}
		serveIndex(w)
	})
}
