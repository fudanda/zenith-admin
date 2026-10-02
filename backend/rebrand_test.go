package arcbase

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fudanda/arcbase/backend/ent/apikey"
)

func TestArcBaseExistingSessionAndKeyUpgrade(t *testing.T) {
	x := newExtensionFixture(t)
	request := httptest.NewRequest("GET", "http://arcbase.test/api/v1/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
	response := httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("old session rejected: %d", response.Code)
	}
	request.AddCookie(&http.Cookie{Name: "arcbase_session", Value: "invalid"})
	response = httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("new cookie must take precedence")
	}

	key := x.key(t, "system:position:list")
	if !strings.HasPrefix(key, "arc_") {
		t.Fatal("new keys must use ArcBase prefix")
	}
	legacyKey := "zen_" + strings.TrimPrefix(key, "arc_")
	ctx := context.Background()
	row := x.f.Store.Client.APIKey.Query().Where(apikey.TokenHashEQ(digest(key))).OnlyX(ctx)
	if err := x.f.Store.Client.APIKey.UpdateOneID(row.ID).SetTokenHash(digest(legacyKey)).SetTokenPrefix(legacyKey[:12]).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if response = x.call("GET", "/api/v1/positions", nil, legacyKey); response.Code != 200 {
		t.Fatalf("old key rejected: %d", response.Code)
	}
	if response = x.call("GET", "/api/v1/users", nil, legacyKey); response.Code != 403 {
		t.Fatal("old key bypassed scope")
	}
	if err := x.f.Store.Client.APIKey.UpdateOneID(row.ID).SetRevokedAt(row.CreatedAt).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if x.call("GET", "/api/v1/positions", nil, legacyKey).Code != 401 {
		t.Fatal("revoked old key accepted")
	}

	request = httptest.NewRequest("POST", "http://arcbase.test/api/v1/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
	request.Header.Set("Origin", "http://arcbase.test")
	request.Header.Set("X-CSRF-Token", x.csrf)
	response = httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("legacy logout: %d %s", response.Code, response.Body.String())
	}
	cleared := map[string]bool{}
	for _, cookie := range response.Result().Cookies() {
		if cookie.MaxAge == -1 && cookie.HttpOnly && cookie.Path == "/" {
			cleared[cookie.Name] = true
		}
	}
	if !cleared["arcbase_session"] || !cleared["zenith_session"] {
		t.Fatal("both cookies must be cleared")
	}
	request = httptest.NewRequest("GET", "http://arcbase.test/api/v1/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
	response = httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("legacy session survived logout")
	}
}
