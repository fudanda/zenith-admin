//go:build integration

package zenith

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent/position"
)

func TestSQLiteReleaseCLI(t *testing.T) {
	binary := os.Getenv("ZENITH_DEPLOYMENT_BINARY")
	if binary == "" {
		t.Skip("set ZENITH_DEPLOYMENT_BINARY to test external SQLite release commands")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	root := t.TempDir()
	dsn := "sqlite:" + filepath.Join(root, "source.db")
	env := append(os.Environ(), "ZENITH_DATABASE_URL="+dsn, "ZENITH_INSECURE_COOKIES=true")
	cli := func(stdin string, args ...string) {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Env = env
		cmd.Stdin = strings.NewReader(stdin)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("release %s: %v %s", args[0], err, output)
		}
	}
	cli("", "migrate")
	cli("", "migrate")
	cli("", "seed")
	cli("", "seed")
	password, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	cli(password+"\n", "init-admin", "sqlite-release")
	store, err := OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	row, err := store.Client.Position.Create().SetName("release before").SetCode("release").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	cli("", "backup-sqlite", filepath.Join(root, "snapshot.db"))
	start := func() func() {
		t.Helper()
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		addr := listener.Addr().String()
		listener.Close()
		cmd := exec.CommandContext(ctx, binary, "serve")
		cmd.Env = append(env, "ZENITH_ADDR="+addr)
		log, err := os.CreateTemp(root, "serve-*.log")
		if err != nil {
			t.Fatal(err)
		}
		cmd.Stdout = log
		cmd.Stderr = log
		if err := cmd.Start(); err != nil {
			log.Close()
			t.Fatal(err)
		}
		stop := func() { _ = cmd.Process.Kill(); _ = cmd.Wait(); _ = log.Close() }
		t.Cleanup(stop)
		client := &http.Client{Timeout: time.Second}
		for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
			res, err := client.Get("http://" + addr + "/api/v1/ready")
			if err == nil {
				res.Body.Close()
				if res.StatusCode == 200 {
					return stop
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("SQLite release did not become ready")
		return stop
	}
	stop := start()
	stop()
	stop = start()
	stop()
	restored, err := OpenStore(ctx, "sqlite:"+filepath.Join(root, "snapshot.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if got, err := restored.Client.Position.Query().Where(position.CodeEQ("release")).Only(ctx); err != nil || got.ID != row.ID || got.Name != "release before" {
		t.Fatal("external snapshot data mismatch", err)
	}
	t.Log(fmt.Sprintf("PASS: external SQLite migrate/seed/init-admin/backup-sqlite, two serve processes and snapshot restoration (%s)", filepath.Base(binary)))
}
