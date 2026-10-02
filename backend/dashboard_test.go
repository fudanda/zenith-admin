package arcbase

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestDashboardRouting(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "not_found", "资源不存在") })
	h := dashboardHandler(api, fstest.MapFS{"index.html": {Data: []byte("<html>original ArcBase</html>")}, "assets/app-abc.js": {Data: []byte("console.log('ArcBase')")}})
	for _, tc := range []struct {
		path   string
		status int
		html   bool
	}{
		{"/dash/", 200, true}, {"/dash/system/users", 200, true}, {"/dash/profile", 200, true}, {"/dash/login", 200, true}, {"/dash/assets/app-abc.js", 200, false}, {"/dash/assets/missing.js", 404, false}, {"/dash/missing", 404, false}, {"/api/v1/missing", 404, false}, {"/dash/../index.html", 404, false},
	} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest("GET", tc.path, nil))
		if res.Code != tc.status || (strings.Contains(res.Body.String(), "<html>")) != tc.html {
			t.Errorf("%s: %d %s", tc.path, res.Code, res.Body.String())
		}
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest("POST", "/dash/system/users", nil))
	if res.Code != 405 {
		t.Fatal(res.Code)
	}
}
