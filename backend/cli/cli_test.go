package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	zenith "github.com/fudanda/zenith-admin/backend"
	"github.com/fudanda/zenith-admin/backend/ent/session"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/internal/operations"
	"golang.org/x/crypto/bcrypt"
)

func call(t *testing.T, config zenith.Config, args []string, input string) (string, error) {
	t.Helper()
	var output bytes.Buffer
	err := Run(context.Background(), Options{Args: args, Input: strings.NewReader(input), Output: &output, ErrorOutput: &output, Config: config})
	return output.String(), err
}
func fixture(t *testing.T) zenith.Config {
	t.Helper()
	config := zenith.Config{DSN: "sqlite:" + filepath.Join(t.TempDir(), "data.db")}
	for _, command := range []string{"migrate", "seed"} {
		if _, err := call(t, config, []string{command}, ""); err != nil {
			t.Fatal(err)
		}
	}
	return config
}

func TestVersionAndConfigurationDoNotExposeSecrets(t *testing.T) {
	output, err := call(t, zenith.Config{}, []string{"version"}, "")
	if err != nil || !strings.Contains(output, "schemaVersion") {
		t.Fatal(output, err)
	}
	config := fixture(t)
	output, err = call(t, config, []string{"check"}, "")
	if err != nil || strings.Contains(output, "sqlite:") {
		t.Fatal(output, err)
	}
	config.StorageEncryptionKey = "secret-value"
	if _, err = call(t, config, []string{"check"}, ""); err == nil || strings.Contains(err.Error(), "secret-value") {
		t.Fatal(err)
	}
}
func TestAdminRecoveryPolicyRevocationAuditAndCredentialFile(t *testing.T) {
	config := fixture(t)
	old := "Aa1!before-reset-91234"
	if _, err := call(t, config, []string{"init-admin", "admin"}, old+"\n"); err != nil {
		t.Fatal(err)
	}
	store, err := zenith.OpenStore(context.Background(), config.DSN)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	account, err := store.Client.User.Query().Where(user.UsernameEQ("admin")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Client.Session.Create().SetUserID(account.ID).SetTokenHash("old-session").SetCsrfHash("csrf").SetExpiresAt(time.Now().Add(time.Hour)).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), ".env")
	if err = os.WriteFile(file, []byte("OTHER=keep\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = call(t, config, []string{"reset-admin", "admin", "--credentials-file", file}, "x\n"); err == nil {
		t.Fatal("weak password accepted")
	}
	raw, _ := os.ReadFile(file)
	if string(raw) != "OTHER=keep\n" {
		t.Fatal("failure did not restore credential file")
	}
	output, err := call(t, config, []string{"reset-admin", "admin", "--generate", "--credentials-file", file}, "")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(file)
	if !strings.Contains(string(raw), "OTHER=keep") {
		t.Fatal("other environment setting lost")
	}
	line := strings.Split(strings.Split(string(raw), "ZENITH_ADMIN_PASSWORD=")[1], "\n")[0]
	var password string
	if err = json.Unmarshal([]byte(line), &password); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output, password) {
		t.Fatal("password printed")
	}
	account, _ = store.Client.User.Get(ctx, account.ID)
	if err = bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password)); err != nil {
		t.Fatal("saved password does not match account")
	}
	count, err := store.Client.Session.Query().Where(session.UserIDEQ(account.ID), session.RevokedAtIsNil()).Count(ctx)
	if err != nil || count != 0 {
		t.Fatal("old session remains active", err)
	}
	count, err = store.Client.AuditLog.Query().Count(ctx)
	if err != nil || count != 1 {
		t.Fatal("recovery audit missing", err)
	}
	_, err = store.Client.User.Create().SetUsername("reader").SetNickname("reader").SetPasswordHash(account.PasswordHash).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = call(t, config, []string{"reset-admin", "reader"}, password+"\n"); err == nil {
		t.Fatal("non-administrator reset accepted")
	}
}
func TestOfflineBackupRestoreChecksumsAndServiceLease(t *testing.T) {
	config := fixture(t)
	ctx := context.Background()
	store, err := zenith.OpenStore(ctx, config.DSN)
	if err != nil {
		t.Fatal(err)
	}
	source := t.TempDir()
	if err = os.WriteFile(filepath.Join(source, "original.txt"), []byte("real-file-bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err = store.Client.FileStorageConfig.Create().SetName("Local").SetLocalRootPath(source).Save(ctx)
	store.Close()
	if err != nil {
		t.Fatal(err)
	}
	config.FileStagingPath = t.TempDir()
	config.StorageEncryptionKey = strings.Repeat("a", 64)
	backup := filepath.Join(t.TempDir(), "snapshot")
	app, err := zenith.New(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = call(t, config, []string{"backup", backup}, ""); err == nil {
		t.Fatal("backup accepted while service owns shared lease")
	}
	app.Shutdown(ctx)
	if _, err = call(t, config, []string{"backup", backup}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = operations.Verify(backup); err != nil {
		t.Fatal(err)
	}
	target := zenith.Config{DSN: "sqlite:" + filepath.Join(t.TempDir(), "restored.db")}
	files := filepath.Join(t.TempDir(), "files")
	env := filepath.Join(t.TempDir(), "restored.env")
	if _, err = call(t, target, []string{"restore", backup, "--files-root", files, "--env-file", env}, ""); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(files, "storage-1", "original.txt"))
	if err != nil || string(raw) != "real-file-bytes" {
		t.Fatal("restored file differs", err)
	}
	if _, err = call(t, target, []string{"check"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = call(t, target, []string{"restore", backup, "--files-root", filepath.Join(t.TempDir(), "files"), "--env-file", filepath.Join(t.TempDir(), "env")}, ""); err == nil {
		t.Fatal("restore overwrote existing database")
	}
	if err = os.WriteFile(filepath.Join(backup, "database.db"), []byte("corrupted"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = operations.Verify(backup); err == nil {
		t.Fatal("corrupted archive accepted")
	}
}
