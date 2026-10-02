//go:build integration

package arcbase

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestGeneratedStandaloneBinaryBrowser(t *testing.T) {
	project, node := os.Getenv("ARCBASE_TOOLING_PROJECT_DIR"), os.Getenv("ARCBASE_BROWSER_TEST_NODE")
	if project == "" || node == "" {
		t.Skip("set generated project directory and browser Node")
	}
	dsn := os.Getenv("ARCBASE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ARCBASE_TEST_DATABASE_URL required")
	}
	dsn = isolatedTestDSN(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	binary := filepath.Join(project, "backend/bin/arcbase")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	directory := t.TempDir()
	staging := filepath.Join(directory, "staging")
	if err = os.Mkdir(staging, 0700); err != nil {
		t.Fatal(err)
	}
	env := []string{}
	for _, line := range os.Environ() {
		if !strings.HasPrefix(line, "ARCBASE_DATABASE_URL=") && !strings.HasPrefix(line, "ARCBASE_ADDR=") && !strings.HasPrefix(line, "ARCBASE_STORAGE_KEY=") && !strings.HasPrefix(line, "ARCBASE_FILE_STAGING_PATH=") && !strings.HasPrefix(line, "ARCBASE_INSECURE_COOKIES=") {
			env = append(env, line)
		}
	}
	env = append(env, "ARCBASE_DATABASE_URL="+dsn, "ARCBASE_ADDR="+address, "ARCBASE_INSECURE_COOKIES=true", "ARCBASE_FILE_STAGING_PATH="+staging, "ARCBASE_STORAGE_KEY="+strings.Repeat("a", 64))
	password := "Generated-browser!123456"
	cli := func(command string, args ...string) {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, append([]string{command}, args...)...)
		cmd.Env = env
		cmd.Stdin = strings.NewReader(password + "\n")
		cmd.Dir = project
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("generated %s: %v %s", command, err, output)
		}
	}
	cli("migrate")
	cli("migrate")
	cli("seed")
	cli("seed")
	cli("init-admin", "browser-admin")
	server := exec.CommandContext(ctx, binary, "serve")
	server.Env = env
	server.Dir = project
	log, err := os.Create(filepath.Join(directory, "service.log"))
	if err != nil {
		t.Fatal(err)
	}
	server.Stdout = log
	server.Stderr = log
	if err = server.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { server.Process.Kill(); server.Wait(); log.Close() }()
	base := "http://" + address
	ready := false
	for start := time.Now(); time.Since(start) < 20*time.Second; {
		response, err := http.Get(base + "/api/v1/ready")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				ready = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		t.Fatal("generated binary not ready")
	}
	for path, status := range map[string]int{"/dash/extensions/inventory/records": 200, "/dash/assets/absent.js": 404, "/api/v1/missing": 404} {
		response, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != status {
			t.Fatalf("static/API %s: %d", path, response.StatusCode)
		}
	}
	script, err := filepath.Abs("../scripts/test-tooling-browser.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, node, script)
	cmd.Env = append(env, "ARCBASE_BROWSER_BASE_URL="+base, "ARCBASE_BROWSER_USERNAME=browser-admin", "ARCBASE_BROWSER_PASSWORD="+password, "ARCBASE_TOOLING_PROJECT_DIR="+project)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("generated browser: %v %s", err, output)
	}
	t.Log(string(output))
	t.Log(fmt.Sprintf("PASS: independent Go binary, %s, original ArcBaseAdmin and generated CRUD", strings.Split(dsn, ":")[0]))
}
