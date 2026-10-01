//go:build integration

package zenith

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// This consumes the built public package, not aliases into the Web source tree.
func TestEmbeddedAdminHost(t *testing.T) {
	node := os.Getenv("ZENITH_BROWSER_TEST_NODE")
	if node == "" {
		t.Skip("set ZENITH_BROWSER_TEST_NODE to run the built admin host acceptance")
	}
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	dsn = isolatedTestDSN(t, dsn)
	store, err := OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	password, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InitAdmin(ctx, "admin-host", password); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := New(ctx, Config{DSN: dsn, SecureCookies: false})
	if err != nil {
		t.Fatal(err)
	}
	defer f.Shutdown(context.Background())
	server := httptest.NewServer(f.Handler())
	defer server.Close()
	for _, path := range []string{"../packages/admin/scripts/host-smoke.mjs", "../packages/elements/scripts/host-smoke.mjs"} {
		script, err := filepath.Abs(path)
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.CommandContext(ctx, node, script)
		cmd.Env = append(os.Environ(), "ZENITH_BROWSER_API_URL="+server.URL, "ZENITH_BROWSER_USERNAME=admin-host", "ZENITH_BROWSER_PASSWORD="+password, "ZENITH_BROWSER_STORAGE="+t.TempDir())
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("built host acceptance %s: %v\n%s", path, err, output)
		}
		t.Log(string(output))
	}
}
