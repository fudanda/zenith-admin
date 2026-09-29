package dash

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDeepLinkAndMissingAssets(t *testing.T) {
	handler := Handler()
	for _, test := range []struct {
		path, accept string
		status       int
		contentType  string
	}{
		{"/dash/system/positions", "text/html", 200, "text/html"},
		{"/dash/assets/not-found.js", "*/*", 404, ""},
		{"/dash/unknown.json", "text/html", 404, ""},
	} {
		req := httptest.NewRequest(http.MethodGet, test.path, nil)
		req.Header.Set("Accept", test.accept)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != test.status {
			t.Errorf("%s: got %d, want %d", test.path, response.Code, test.status)
		}
		if test.contentType != "" && !strings.Contains(response.Header().Get("Content-Type"), test.contentType) {
			t.Errorf("%s: wrong content type %s", test.path, response.Header().Get("Content-Type"))
		}
	}
}
