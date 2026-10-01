//go:build integration

package zenith

import (
	"context"
	"image"
	"image/png"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// The browser uses original packages/web components and a real Go/DB fixture.
// This optional browser runner is separate from mandatory DB integration tests.
func TestOriginalWebFoundation(t *testing.T) {
	node := os.Getenv("ZENITH_BROWSER_TEST_NODE")
	if node == "" {
		t.Skip("set ZENITH_BROWSER_TEST_NODE to run the real browser acceptance test")
	}
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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
	const username = "foundation-browser"
	if err := store.InitAdmin(ctx, username, password); err != nil {
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
	script, err := filepath.Abs("../packages/web/scripts/foundation-smoke.mjs")
	if err != nil {
		t.Fatal(err)
	}
	importPath := filepath.Join(t.TempDir(), "browser-import.xlsx")
	if err := os.WriteFile(importPath, importWorkbook(t, [][]string{{"browser_import", "浏览器导入用户", "", password, "", "", "", "enabled"}}), 0600); err != nil {
		t.Fatal(err)
	}
	avatarPath := filepath.Join(t.TempDir(), "browser-avatar.png")
	avatar, err := os.Create(avatarPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(avatar, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		avatar.Close()
		t.Fatal(err)
	}
	if err := avatar.Close(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, node, script)
	cmd.Env = append(os.Environ(), "ZENITH_BROWSER_API_URL="+server.URL, "ZENITH_BROWSER_USERNAME="+username, "ZENITH_BROWSER_PASSWORD="+password, "ZENITH_BROWSER_STORAGE="+t.TempDir(), "ZENITH_BROWSER_IMPORT_FILE="+importPath, "ZENITH_BROWSER_AVATAR_FILE="+avatarPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("original Web browser acceptance: %v\n%s", err, output)
	}
	t.Log(string(output))
}
