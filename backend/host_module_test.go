package arcbase_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	arcbase "github.com/fudanda/arcbase/backend"
	"github.com/fudanda/arcbase/backend/ent/auditlog"
	"github.com/fudanda/arcbase/backend/ent/menu"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/ent/userrole"
	"github.com/fudanda/arcbase/backend/examples/hostmodule"
)

type hostFixture struct {
	framework *arcbase.Framework
	server    *httptest.Server
	password  string
}

func hostFixtureNew(t *testing.T) *hostFixture {
	t.Helper()
	ctx := context.Background()
	dsn := "sqlite:" + filepath.Join(t.TempDir(), "host.db")
	if value := os.Getenv("ARCBASE_TEST_DATABASE_URL"); strings.HasPrefix(value, "postgres") {
		database, err := arcbase.OpenStore(ctx, value)
		if err != nil {
			t.Fatal(err)
		}
		raw := make([]byte, 8)
		rand.Read(raw)
		schema := "arcbase_host_" + hex.EncodeToString(raw)
		if _, err = database.DB.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			database.DB.ExecContext(context.Background(), `DROP SCHEMA "`+schema+`" CASCADE`)
			database.Close()
		})
		parsed, err := url.Parse(value)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dsn = parsed.String()
	}
	store, err := arcbase.OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	raw := make([]byte, 24)
	rand.Read(raw)
	password := "Host!" + hex.EncodeToString(raw)
	for _, name := range []string{"host-admin", "host-reader"} {
		if err = store.InitAdmin(ctx, name, password); err != nil {
			t.Fatal(err)
		}
	}
	reader, err := store.Client.User.Query().Where(user.UsernameEQ("host-reader")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Client.UserRole.Delete().Where(userrole.UserIDEQ(reader.ID)).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	list, err := store.Client.Menu.Query().Where(menu.PermissionEQ("system:position:list")).First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Client.UserMenu.Create().SetUserID(reader.ID).SetMenuID(list.ID).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	store.Close()
	f, err := arcbase.New(ctx, arcbase.Config{DSN: dsn, Modules: []arcbase.Module{&hostmodule.Module{}}, SecureCookies: false, DashboardFS: fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>host route fixture</html>")}}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(f.Handler())
	t.Cleanup(func() { server.Close(); f.Shutdown(context.Background()) })
	return &hostFixture{f, server, password}
}
func hostCall(t *testing.T, client *http.Client, method, path string, body any, csrf string) (int, map[string]any) {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r, err := http.NewRequest(method, path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	parsed, _ := url.Parse(path)
	r.Header.Set("Origin", parsed.Scheme+"://"+parsed.Host)
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	payload := map[string]any{}
	json.NewDecoder(response.Body).Decode(&payload)
	return response.StatusCode, payload
}
func hostLogin(t *testing.T, x *hostFixture, name string) (*http.Client, string) {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	status, payload := hostCall(t, client, "GET", x.server.URL+"/api/v1/auth/captcha", nil, "")
	if status != 200 {
		t.Fatalf("captcha status %d", status)
	}
	data := payload["data"].(map[string]any)
	image := data["image"].(string)
	svg, err := base64.StdEncoding.DecodeString(strings.SplitN(image, ",", 2)[1])
	if err != nil {
		t.Fatal(err)
	}
	answer := regexp.MustCompile(`>([A-F0-9]{6})</text>`).FindSubmatch(svg)
	if len(answer) != 2 {
		t.Fatal("captcha answer missing")
	}
	status, payload = hostCall(t, client, "POST", x.server.URL+"/api/v1/auth/login", map[string]any{"username": name, "password": x.password, "captchaId": data["captchaId"], "captchaAnswer": string(answer[1])}, "")
	if status != 200 {
		t.Fatalf("login status %d: %v", status, payload["message"])
	}
	return client, payload["data"].(map[string]any)["csrfToken"].(string)
}

func TestHostModuleAuthorizationValidationAndAudit(t *testing.T) {
	x := hostFixtureNew(t)
	admin, csrf := hostLogin(t, x, "host-admin")
	reader, readerCSRF := hostLogin(t, x, "host-reader")
	endpoint := x.server.URL + "/api/v1/extensions/position-host/positions"
	if status, payload := hostCall(t, reader, "GET", x.server.URL+"/api/v1/modules", nil, ""); status != 200 || len(payload["data"].([]any)) != 1 {
		t.Fatalf("host capability catalog %d", status)
	}
	if status, _ := hostCall(t, http.DefaultClient, "GET", endpoint, nil, ""); status != 401 {
		t.Fatalf("anonymous %d", status)
	}
	if status, _ := hostCall(t, admin, "POST", endpoint, map[string]any{"name": "Host", "code": "host"}, ""); status != 403 {
		t.Fatalf("CSRF %d", status)
	}
	if status, _ := hostCall(t, admin, "GET", endpoint+"?pageSize=500", nil, ""); status != 400 {
		t.Fatalf("pagination %d", status)
	}
	if status, _ := hostCall(t, admin, "POST", endpoint, map[string]any{"name": "Host", "code": "host", "unknown": true}, csrf); status != 400 {
		t.Fatalf("body validation %d", status)
	}
	if status, _ := hostCall(t, reader, "POST", endpoint, map[string]any{"name": "Denied", "code": "denied"}, readerCSRF); status != 403 {
		t.Fatalf("write permission %d", status)
	}
	if status, payload := hostCall(t, admin, "POST", endpoint, map[string]any{"name": "Host API Position", "code": "host_api_position"}, csrf); status != 201 {
		t.Fatalf("create %d %v", status, payload["message"])
	}
	if status, payload := hostCall(t, reader, "GET", endpoint+"?keyword=host_api_position", nil, ""); status != 200 || payload["data"].(map[string]any)["total"].(float64) != 1 {
		t.Fatalf("read %d", status)
	}
	if count, err := x.framework.Store.Client.AuditLog.Query().Where(auditlog.PathEQ("/api/v1/extensions/position-host/positions"), auditlog.OperationEQ("create")).Count(context.Background()); err != nil || count != 1 {
		t.Fatalf("host audit %d %v", count, err)
	}
	status, payload := hostCall(t, admin, "POST", x.server.URL+"/api/v1/menus", map[string]any{"title": "宿主岗位新增", "type": "button", "permission": "host:position-host:create", "parentId": 0}, csrf)
	if status != 201 {
		t.Fatalf("custom button declaration %d %v", status, payload["message"])
	}
	buttonID := int(payload["data"].(map[string]any)["id"].(float64))
	readerRow, err := x.framework.Store.Client.User.Query().Where(user.UsernameEQ("host-reader")).Only(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = x.framework.Store.Client.UserMenu.Create().SetUserID(readerRow.ID).SetMenuID(buttonID).Exec(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status, _ = hostCall(t, reader, "POST", endpoint, map[string]any{"name": "Denied", "code": "denied"}, readerCSRF); status != 403 {
		t.Fatalf("underlying domain permission bypass %d", status)
	}
	if _, err := x.framework.Store.Client.UserMenu.Delete().Exec(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status, _ := hostCall(t, reader, "GET", endpoint, nil, ""); status != 403 {
		t.Fatalf("revoked permission %d", status)
	}
	if _, err := x.framework.HostServices().Positions.List(context.Background(), arcbase.PositionFilter{}, 1, 10); err != arcbase.ErrUnauthenticated {
		t.Fatal("service bypass accepted", err)
	}
	for path, status := range map[string]int{"/dash/extensions/position-host/positions": 200, "/dash/extensions/position-host/missing": 404, "/dash/extensions/position-host/missing.js": 404} {
		response, err := http.Get(x.server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != status {
			t.Fatalf("%s %d", path, response.StatusCode)
		}
	}
}

func TestIndependentPackageHostBrowser(t *testing.T) {
	node := os.Getenv("ARCBASE_BROWSER_TEST_NODE")
	directory := os.Getenv("ARCBASE_EXTERNAL_HOST_DIR")
	if node == "" || directory == "" {
		t.Skip("set browser Node and independently installed host directory")
	}
	x := hostFixtureNew(t)
	script, err := filepath.Abs("../scripts/test-host-browser.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, script)
	cmd.Env = append(os.Environ(), "ARCBASE_EXTERNAL_HOST_DIR="+directory, "ARCBASE_BROWSER_API_URL="+x.server.URL, "ARCBASE_BROWSER_USERNAME=host-admin", "ARCBASE_BROWSER_PASSWORD="+x.password)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("external host browser: %v\n%s", err, output)
	}
	t.Log(string(output))
}
