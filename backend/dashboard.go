package arcbase

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/fudanda/arcbase/backend/internal/dashboard"
	"github.com/fudanda/arcbase/backend/internal/kernel"
)

func dashboardHandler(api http.Handler, assets fs.FS, extraPages ...string) http.Handler {
	if assets == nil {
		assets = dashboard.Assets()
	}
	pages := map[string]bool{"/": true, "/login": true, "/profile": true}
	for _, page := range extraPages {
		pages[page] = true
	}
	for _, menu := range kernel.FoundationMenus {
		if menu.Component != "" {
			pages[menu.Path] = true
		}
	}
	files := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/dash" && !strings.HasPrefix(r.URL.Path, "/dash/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			fail(w, 405, "method_not_allowed", "请求方法不支持")
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, "/dash")
		if rel == "" {
			http.Redirect(w, r, "/dash/", http.StatusTemporaryRedirect)
			return
		}
		if path.Clean(rel) != rel && rel != "/" {
			fail(w, 404, "not_found", "资源不存在")
			return
		}
		name := strings.TrimPrefix(rel, "/")
		if name == "" || pages[rel] {
			if _, err := fs.Stat(assets, "index.html"); err != nil {
				fail(w, 503, "dashboard_unbuilt", "管理台尚未构建")
				return
			}
			name = "index.html"
		} else {
			stat, err := fs.Stat(assets, name)
			if err != nil || stat.IsDir() || strings.HasSuffix(name, ".txt") {
				fail(w, 404, "not_found", "资源不存在")
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		request := r.Clone(r.Context())
		copied := *r.URL
		request.URL = &copied
		request.URL.Path = "/" + name
		// FileServer redirects /index.html; using / selects the same file without redirect.
		if name == "index.html" {
			request.URL.Path = "/"
		}
		files.ServeHTTP(w, request)
	})
}
