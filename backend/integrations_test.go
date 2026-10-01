package zenith

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/apikey"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type extensionFixture struct {
	f           *Framework
	token, csrf string
	password    string
}

func newExtensionFixture(t *testing.T) *extensionFixture {
	t.Helper()
	return extensionFixtureDSN(t, "sqlite:"+filepath.Join(t.TempDir(), "extensions.db"))
}
func extensionFixtureDSN(t *testing.T, dsn string) *extensionFixture {
	t.Helper()
	ctx := context.Background()
	store, err := OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	password, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	if err = store.InitAdmin(ctx, "extension-admin", password); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(contracts.Settings["auth"].Defaults)
	var settings map[string]any
	json.Unmarshal(raw, &settings)
	settings["captchaEnabled"] = false
	if err = store.Client.SystemSetting.Create().SetModule("auth").SetVersion(1).SetData(settings).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	store.Close()
	f, err := New(ctx, Config{DSN: dsn, SecureCookies: false, StorageEncryptionKey: strings.Repeat("ab", 32), FileStagingPath: filepath.Join(t.TempDir(), "uploads")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Shutdown(context.Background()) })
	result, err := f.services.identity.Login(ctx, kernel.Input{SourceValid: true, IP: "192.0.2.50", Body: json.RawMessage(`{"username":"extension-admin","password":"` + password + `"}`)})
	if err != nil || result.Cookie == nil {
		t.Fatal("login", err)
	}
	return &extensionFixture{f: f, token: result.Cookie.Token, csrf: result.Data.(map[string]any)["csrfToken"].(string), password: password}
}
func (x *extensionFixture) call(method, path string, body any, key string) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	request := httptest.NewRequest(method, "http://zenith.test"+path, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	if key == "" {
		request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
		request.Header.Set("X-CSRF-Token", x.csrf)
	} else {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	request.Header.Set("Origin", "http://zenith.test")
	response := httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	return response
}
func extensionData(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if response.Code != 200 && response.Code != 201 {
		t.Fatalf("response %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if json.Unmarshal(response.Body.Bytes(), &envelope) != nil {
		t.Fatal("invalid envelope")
	}
	return envelope.Data
}
func (x *extensionFixture) key(t *testing.T, permissions ...string) string {
	t.Helper()
	data := extensionData(t, x.call("POST", "/api/v1/api-tokens", map[string]any{"name": "integration", "permissions": permissions}, ""))
	return data["token"].(string)
}
func TestAPIKeyScopesRevocationAndOwnerChanges(t *testing.T) {
	testAPIKeyLifecycle(t, newExtensionFixture(t))
}
func testAPIKeyLifecycle(t *testing.T, x *extensionFixture) {
	key := x.key(t, "system:position:list", "system:position:create")
	ctx := context.Background()
	row, err := x.f.Store.Client.APIKey.Query().Where(apikey.TokenHashEQ(digest(key))).Only(ctx)
	if err != nil || row.TokenHash == key {
		t.Fatal("key storage", err)
	}
	for _, path := range []string{"/api/v1/auth/me", "/api/v1/users", "/api/v1/file-storage-configs"} {
		response := x.call("GET", path, nil, key)
		if response.Code != 403 {
			t.Fatalf("scope bypass %s %d", path, response.Code)
		}
	}
	created := x.call("POST", "/api/v1/positions", map[string]any{"name": "key position", "code": "key_position"}, key)
	if created.Code != 201 {
		t.Fatalf("key write %d %s", created.Code, created.Body.String())
	}
	denied := x.call("POST", "/api/v1/api-tokens", map[string]any{"name": "escalation", "permissions": []string{"system:position:list"}}, key)
	if denied.Code != 403 {
		t.Fatal("key minted a key")
	}
	if response := x.call("POST", "/api/v1/api-tokens", map[string]any{"name": "wildcard", "permissions": []string{"*"}}, ""); response.Code != 403 {
		t.Fatal("wildcard accepted", response.Code)
	}
	list := x.call("GET", "/api/v1/api-tokens", nil, "")
	if strings.Contains(list.Body.String(), key) {
		t.Fatal("secret exposed")
	}
	for _, record := range x.f.Store.Client.AuditLog.Query().Where(auditlog.ResourceEQ("api_keys")).AllX(ctx) {
		if record.RequestBody != nil && *record.RequestBody != "" {
			t.Fatal("key audit recorded request body")
		}
	}
	x.f.Store.Client.APIKey.UpdateOneID(row.ID).SetExpiresAt(time.Now().Add(-time.Second)).Exec(ctx)
	if x.call("GET", "/api/v1/positions", nil, key).Code != 401 {
		t.Fatal("expired key permitted")
	}
	x.f.Store.Client.APIKey.UpdateOneID(row.ID).ClearExpiresAt().Exec(ctx)
	x.f.Store.Client.User.UpdateOneID(row.UserID).SetStatus("disabled").Exec(ctx)
	if x.call("GET", "/api/v1/positions", nil, key).Code != 401 {
		t.Fatal("disabled owner permitted")
	}
	x.f.Store.Client.User.UpdateOneID(row.UserID).SetStatus("enabled").Exec(ctx)
	adminRole, err := x.f.Store.Client.Role.Query().Where(role.CodeEQ("super_admin")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	x.f.Store.Client.Role.UpdateOneID(adminRole.ID).SetStatus("disabled").Exec(ctx)
	if x.call("GET", "/api/v1/positions", nil, key).Code != 403 {
		t.Fatal("disabled role still permitted")
	}
	x.f.Store.Client.Role.UpdateOneID(adminRole.ID).SetStatus("enabled").Exec(ctx)
	if x.call("DELETE", "/api/v1/api-tokens/"+strconv.Itoa(row.ID), nil, "").Code != 200 {
		t.Fatal("revoke failed")
	}
	if x.call("GET", "/api/v1/positions", nil, key).Code != 401 {
		t.Fatal("revocation ineffective")
	}
	key = x.key(t, "system:position:list")
	principal, err := x.f.services.identity.Authenticate(ctx, x.token)
	if err != nil {
		t.Fatal(err)
	}
	x.f.Store.Client.User.UpdateOneID(principal.User.ID).SetPasswordUpdatedAt(time.Now().Add(time.Second)).Exec(ctx)
	if x.call("GET", "/api/v1/positions", nil, key).Code != 401 {
		t.Fatal("password reset did not revoke key")
	}
}

type keyTransport struct {
	base http.RoundTripper
	key  string
}

func (t keyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	copy := r.Clone(r.Context())
	copy.Header.Set("Authorization", "Bearer "+t.key)
	return t.base.RoundTrip(copy)
}
func TestReadOnlyMCPWithOfficialClient(t *testing.T) {
	testReadOnlyMCP(t, newExtensionFixture(t))
}
func testReadOnlyMCP(t *testing.T, x *extensionFixture) {
	key := x.key(t, "system:position:list")
	server := httptest.NewServer(x.f.Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "zenith-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/api/v1/mcp", HTTPClient: &http.Client{Transport: keyTransport{http.DefaultTransport, key}}, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) != 1 || tools.Tools[0].Name != "positions_list" || !tools.Tools[0].Annotations.ReadOnlyHint {
		t.Fatalf("tool projection %+v", tools)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "positions_list", Arguments: map[string]any{"page": 1, "pageSize": 10}})
	if err != nil || result.IsError {
		t.Fatal("read tool", err, result)
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "users_list", Arguments: map[string]any{}})
	if err == nil && !result.IsError {
		t.Fatal("ungranted tool was exposed")
	}
	result, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "positions_list", Arguments: map[string]any{"pageSize": 1000}})
	if err == nil && !result.IsError {
		t.Fatal("page limit bypass")
	}
	for _, record := range x.f.Store.Client.AuditLog.Query().Where(auditlog.ResourceEQ("mcp")).AllX(ctx) {
		if record.RequestBody != nil && *record.RequestBody != "" {
			t.Fatal("MCP arguments entered audit")
		}
		if record.APIKeyID == nil {
			t.Fatal("MCP key identity missing from audit")
		}
	}
	if x.call("GET", "/api/v1/mcp", nil, key).Code != 405 {
		t.Fatal("stateless MCP GET must return 405")
	}
}
func TestSubscriptionChangesAndShutdown(t *testing.T) {
	testSubscription(t, newExtensionFixture(t))
}
func testSubscription(t *testing.T, x *extensionFixture) {
	key := x.key(t, "system:position:list")
	server := httptest.NewServer(x.f.Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/v1/events", nil)
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	frame := func() string {
		var lines strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			lines.WriteString(line)
			if line == "\n" {
				return lines.String()
			}
		}
	}
	if !strings.Contains(frame(), "event: ready") {
		t.Fatal("not ready")
	}
	extensionData(t, x.call("POST", "/api/v1/positions", map[string]any{"name": "stream", "code": "stream"}, ""))
	for {
		event := frame()
		if strings.Contains(event, "event: change") {
			if !strings.Contains(event, "positions") || strings.Contains(event, "stream\"") {
				t.Fatal("invalid event", event)
			}
			break
		}
	}
	stop, done := context.WithTimeout(context.Background(), 3*time.Second)
	defer done()
	if err = x.f.Shutdown(stop); err != nil {
		t.Fatal("stream prevented shutdown", err)
	}
	_, err = io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
}
