//go:build integration

package zenith

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"image"
	"image/png"
	"io"
	"io/fs"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// This opt-in acceptance uses the release executable, not an in-process app.
// Its PostgreSQL container must be dedicated: the outage check stops it briefly.
func TestReleaseHTTPSBackupRecovery(t *testing.T) {
	binary, container := os.Getenv("ZENITH_DEPLOYMENT_BINARY"), os.Getenv("ZENITH_ACCEPTANCE_PG_CONTAINER")
	if binary == "" || container == "" {
		t.Skip("set ZENITH_DEPLOYMENT_BINARY and a dedicated ZENITH_ACCEPTANCE_PG_CONTAINER")
	}
	node := os.Getenv("ZENITH_BROWSER_TEST_NODE")
	if node == "" {
		t.Fatal("ZENITH_BROWSER_TEST_NODE is required for release acceptance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	dsn, err := url.Parse(os.Getenv("ZENITH_TEST_DATABASE_URL"))
	if err != nil || dsn.Host == "" {
		t.Fatal("a real PostgreSQL test URL is required")
	}
	if dsn.User == nil || dsn.User.Username() == "" {
		t.Fatal("PostgreSQL acceptance requires an explicit database user")
	}
	databaseUser := dsn.User.Username()
	admin, err := OpenStore(ctx, dsn.String())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	stamp := time.Now().UnixNano()
	source, recovered := fmt.Sprintf("zenith_release_%d", stamp), fmt.Sprintf("zenith_recovery_%d", stamp)
	for _, name := range []string{source, recovered} {
		if _, err := admin.DB.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
			t.Fatal(err)
		}
		defer func(name string) {
			_, _ = admin.DB.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		}(name)
	}
	databaseURL := func(name string) string { clone := *dsn; clone.Path = "/" + name; return clone.String() }
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	artifacts := os.Getenv("ZENITH_ACCEPTANCE_ARTIFACTS")
	if artifacts == "" {
		artifacts = t.TempDir()
	}
	if err := os.MkdirAll(artifacts, 0700); err != nil {
		t.Fatal(err)
	}
	storage := filepath.Join(t.TempDir(), "files")
	if err := os.MkdirAll(storage, 0700); err != nil {
		t.Fatal(err)
	}
	env := func(name string) []string {
		return append(os.Environ(), "ZENITH_DATABASE_URL="+databaseURL(name), "ZENITH_ADDR="+address, "ZENITH_INSECURE_COOKIES=false")
	}
	cli := func(command string, input string, args ...string) {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, append([]string{command}, args...)...)
		cmd.Env, cmd.Stdin = env(source), strings.NewReader(input)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("release %s: %v (%s)", command, err, output)
		}
	}
	cli("migrate", "")
	cli("migrate", "")
	cli("seed", "")
	cli("seed", "")
	password, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	const username = "release-admin"
	cli("init-admin", password+"\n", username)
	t.Log("PASS: empty database, repeated CLI migrations/seed and explicit administrator initialization")
	var running *exec.Cmd
	var finished chan error
	var processLog *os.File
	stop := func() {
		if running != nil {
			_ = running.Process.Kill()
			<-finished
			_ = processLog.Close()
			running = nil
		}
	}
	defer stop()
	target, _ := url.Parse("http://" + address)
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) { director(r); r.Header.Set("X-Forwarded-Proto", "https") }
	tlsServer := httptest.NewTLSServer(proxy)
	defer tlsServer.Close()
	client := tlsServer.Client()
	client.Timeout = 15 * time.Second
	client.Jar, _ = cookiejar.New(nil)
	start := func(name string) {
		t.Helper()
		processLog, err = os.OpenFile(filepath.Join(artifacts, "release-process.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		running = exec.CommandContext(ctx, binary, "serve")
		running.Env, running.Stdout, running.Stderr = env(name), processLog, processLog
		if err := running.Start(); err != nil {
			t.Fatal(err)
		}
		finished = make(chan error, 1)
		go func(command *exec.Cmd) { finished <- command.Wait() }(running)
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			response, err := client.Get(tlsServer.URL + "/api/v1/ready")
			if err == nil {
				response.Body.Close()
				if response.StatusCode == 200 {
					return
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("release binary did not become ready")
	}
	start(source)
	certificate := filepath.Join(t.TempDir(), "acceptance-ca.pem")
	if err := os.WriteFile(certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: tlsServer.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	importPath, avatarPath := filepath.Join(t.TempDir(), "users.xlsx"), filepath.Join(t.TempDir(), "avatar.png")
	if err := os.WriteFile(importPath, importWorkbook(t, [][]string{{"browser_import", "浏览器导入用户", "", password, "", "", "", "enabled"}}), 0600); err != nil {
		t.Fatal(err)
	}
	var avatar bytes.Buffer
	if err := png.Encode(&avatar, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(avatarPath, avatar.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	script, err := filepath.Abs("../packages/web/scripts/foundation-smoke.mjs")
	if err != nil {
		t.Fatal(err)
	}
	browser := exec.CommandContext(ctx, node, script)
	browser.Env = append(os.Environ(), "ZENITH_BROWSER_PRODUCTION=true", "ZENITH_BROWSER_HTTPS=true", "NODE_EXTRA_CA_CERTS="+certificate, "ZENITH_BROWSER_API_URL="+tlsServer.URL, "ZENITH_BROWSER_USERNAME="+username, "ZENITH_BROWSER_PASSWORD="+password, "ZENITH_BROWSER_STORAGE="+storage, "ZENITH_BROWSER_IMPORT_FILE="+importPath, "ZENITH_BROWSER_AVATAR_FILE="+avatarPath, "ZENITH_ACCEPTANCE_SCREENSHOTS="+filepath.Join(artifacts, "screenshots"))
	output, err := browser.CombinedOutput()
	if err := os.WriteFile(filepath.Join(artifacts, "release-browser.log"), output, 0600); err != nil {
		t.Fatal(err)
	}
	if err != nil {
		t.Fatalf("HTTPS original Web acceptance: %v\n%s", err, output)
	}
	t.Log(string(output))
	var csrf string
	request := func(method, path string, body io.Reader, contentType string, expected int) (*http.Response, []byte) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, tlsServer.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", tlsServer.URL)
		req.Header.Set("X-CSRF-Token", csrf)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != expected {
			t.Fatalf("%s %s: status %d expected %d", method, path, response.StatusCode, expected)
		}
		return response, data
	}
	jsonRequest := func(method, path string, payload any, expected int) map[string]any {
		t.Helper()
		var body io.Reader
		if payload != nil {
			data, _ := json.Marshal(payload)
			body = bytes.NewReader(data)
		}
		_, raw := request(method, path, body, "application/json", expected)
		var response struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		return response.Data
	}
	captcha := jsonRequest("GET", "/api/v1/auth/captcha", nil, 200)
	svg, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(captcha["image"].(string), "data:image/svg+xml;base64,"))
	answer := regexp.MustCompile(`>([A-F0-9]{4,8})</text>`).FindSubmatch(svg)
	if len(answer) != 2 {
		t.Fatal("captcha challenge missing")
	}
	_, loginBody := request("POST", "/api/v1/auth/login", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q,"captchaId":%q,"captchaAnswer":%q}`, username, password, captcha["captchaId"], answer[1])), "application/json", 200)
	var login struct {
		Data struct {
			CSRF string `json:"csrfToken"`
		} `json:"data"`
	}
	if err := json.Unmarshal(loginBody, &login); err != nil {
		t.Fatal(err)
	}
	csrf = login.Data.CSRF
	jarURL, _ := url.Parse(tlsServer.URL)
	if len(client.Jar.Cookies(jarURL)) == 0 || csrf == "" {
		t.Fatal("HTTPS session was not retained")
	}
	request("GET", "/dash/system/users", nil, "", 200)
	request("GET", "/dash/missing-resource.js", nil, "", 404)
	request("GET", "/api/v1/unknown", nil, "", 404)
	request("GET", "/api/v1/tenants", nil, "", 404)
	request("GET", "/api/positions", nil, "", 404)
	position := jsonRequest("POST", "/api/v1/positions", map[string]any{"name": "备份前岗位", "code": "recovery_marker"}, 201)
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("file", "recovery.txt")
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("verified private file restored with its database metadata")
	if _, err = part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	_, rawFile := request("POST", "/api/v1/files/upload-one?visibility=restricted", &upload, writer.FormDataContentType(), 200)
	var file struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = json.Unmarshal(rawFile, &file); err != nil {
		t.Fatal(err)
	}
	_, downloaded := request("GET", "/api/v1/files/"+file.Data.ID+"/private-content", nil, "", 200)
	if !bytes.Equal(content, downloaded) {
		t.Fatal("uploaded file differs")
	}
	stop()
	start(source)
	jsonRequest("GET", "/api/v1/auth/me", nil, 200)
	_, downloaded = request("GET", "/api/v1/files/"+file.Data.ID+"/private-content", nil, "", 200)
	if !bytes.Equal(content, downloaded) {
		t.Fatal("file did not survive process restart")
	}
	t.Log("PASS: real release process restart restores HTTPS session, settings and private files")
	stop()
	docker := func(args ...string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, "docker", args...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		result, err := cmd.Output()
		if err != nil {
			t.Fatalf("PostgreSQL acceptance command: %v (%s)", err, stderr.String())
		}
		return result
	}
	dump := docker("exec", container, "pg_dump", "-U", databaseUser, "-Fc", source)
	if err := os.WriteFile(filepath.Join(artifacts, fmt.Sprintf("postgres-%d.dump", stamp)), dump, 0600); err != nil {
		t.Fatal(err)
	}
	backupFiles := filepath.Join(artifacts, fmt.Sprintf("files-%d", stamp))
	hashes := copyAcceptanceFiles(t, storage, backupFiles)
	start(source)
	jsonRequest("PUT", fmt.Sprintf("/api/v1/positions/%d", int(position["id"].(float64))), map[string]any{"name": "备份后修改"}, 200)
	stop()
	restore := exec.CommandContext(ctx, "docker", "exec", "-i", container, "pg_restore", "-U", databaseUser, "--no-owner", "--exit-on-error", "-d", recovered)
	restore.Stdin = bytes.NewReader(dump)
	if output, err := restore.CombinedOutput(); err != nil {
		t.Fatalf("pg_restore: %v (%s)", err, output)
	}
	if err := os.Rename(storage, storage+".unavailable"); err != nil {
		t.Fatal(err)
	}
	restoredHashes := copyAcceptanceFiles(t, backupFiles, storage)
	if fmt.Sprint(hashes) != fmt.Sprint(restoredHashes) {
		t.Fatal("restored file directory SHA256 differs")
	}
	start(recovered)
	jsonRequest("GET", "/api/v1/auth/me", nil, 200)
	restored := jsonRequest("GET", fmt.Sprintf("/api/v1/positions/%d", int(position["id"].(float64))), nil, 200)
	if restored["name"] != "备份前岗位" {
		t.Fatal("database restoration used post-snapshot data")
	}
	preferences := jsonRequest("GET", "/api/v1/auth/preferences", nil, 200)
	if preferences["overrides"].(map[string]any)["colorMode"] != "dark" {
		t.Fatal("preferences were not restored")
	}
	_, downloaded = request("GET", "/api/v1/files/"+file.Data.ID+"/private-content", nil, "", 200)
	if !bytes.Equal(downloaded, content) {
		t.Fatal("restored private file content differs")
	}
	t.Logf("PASS: pg_dump/pg_restore into another empty database; snapshot data, session, preference and %d file SHA256 values restored", len(hashes))
	docker("stop", "--time", "10", container)
	defer func() { _ = exec.Command("docker", "start", container).Run() }()
	for _, path := range []string{"/api/v1/health", "/api/v1/ready", "/api/v1/auth/me", "/api/v1/auth/captcha"} {
		request("GET", path, nil, "", 503)
	}
	jsonRequest("POST", "/api/v1/auth/login", map[string]any{"username": username, "password": password}, 503)
	docker("start", container)
	deadline := time.Now().Add(30 * time.Second)
	for {
		response, err := client.Get(tlsServer.URL + "/api/v1/ready")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("database did not recover")
		}
		time.Sleep(200 * time.Millisecond)
	}
	jsonRequest("GET", "/api/v1/auth/me", nil, 200)
	t.Log("PASS: real PostgreSQL outage returns 503 for health/readiness/authentication; database restart recovers without bypass")
}

func copyAcceptanceFiles(t *testing.T, source, destination string) map[string]string {
	t.Helper()
	hashes := map[string]string{}
	if err := filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected nonregular acceptance file: %s", rel)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		hashes[rel] = fmt.Sprintf("%x", sha256.Sum256(data))
		return os.WriteFile(target, data, 0600)
	}); err != nil {
		t.Fatal(err)
	}
	return hashes
}

type releaseDrainModule struct {
	entered, release, stopped chan struct{}
}

func (m *releaseDrainModule) Name() string           { return "release-drain-test" }
func (m *releaseDrainModule) Dependencies() []string { return nil }
func (m *releaseDrainModule) Initialize(_ context.Context, r *Registrar) error {
	return r.Register(Route{Method: "GET", Path: "/api/v1/release-drain-test", OperationID: "release.drain.test", Public: true, Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(m.entered)
		<-m.release
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("drained"))
	})})
}
func (m *releaseDrainModule) Shutdown(context.Context) error { close(m.stopped); return nil }

func TestGracefulReleaseShutdown(t *testing.T) {
	a := newAPIFixture(t)
	dsn := a.f.config.DSN
	if err := a.f.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	module := &releaseDrainModule{make(chan struct{}), make(chan struct{}), make(chan struct{})}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(module.release) }) }
	defer release()
	f, err := New(context.Background(), Config{DSN: dsn, Address: address, Modules: []Module{module}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { release(); _ = f.Shutdown(context.Background()) })
	runContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- f.Run(runContext) }()
	client := &http.Client{Timeout: 10 * time.Second}
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := client.Get("http://" + address + "/api/v1/ready")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("shutdown fixture did not listen")
		}
		time.Sleep(20 * time.Millisecond)
	}
	requestDone := make(chan error, 1)
	go func() {
		response, err := client.Get("http://" + address + "/api/v1/release-drain-test")
		if err == nil {
			data, readErr := io.ReadAll(response.Body)
			response.Body.Close()
			if readErr != nil {
				err = readErr
			} else if response.StatusCode != 200 || string(data) != "drained" {
				err = fmt.Errorf("active request was not drained")
			}
		}
		requestDone <- err
	}()
	select {
	case <-module.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("active request did not start")
	}
	shutdownDone := make(chan error, 1)
	go func() {
		ctx, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		shutdownDone <- f.Shutdown(ctx)
	}()
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not stop the listener")
	}
	newRequest := httptest.NewRecorder()
	f.Handler().ServeHTTP(newRequest, httptest.NewRequest("GET", "/api/v1/ready", nil))
	if newRequest.Code != 503 {
		t.Fatal("shutdown accepted a new request")
	}
	select {
	case <-module.stopped:
		t.Fatal("module stopped before active request drained")
	default:
	}
	release()
	if err := <-requestDone; err != nil {
		t.Fatal(err)
	}
	if err := <-shutdownDone; err != nil {
		t.Fatal(err)
	}
	select {
	case <-module.stopped:
	default:
		t.Fatal("module was not closed")
	}
	if err := f.Store.DB.PingContext(context.Background()); err == nil {
		t.Fatal("database pool remained open")
	}
	if err := f.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Log("PASS: stop listener and reject new requests, drain active request, stop module/maintenance and close pool; repeated shutdown succeeds")
}
