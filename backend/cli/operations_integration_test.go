//go:build integration

package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	arcbase "github.com/fudanda/arcbase/backend"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/internal/storage"
	"golang.org/x/crypto/bcrypt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRealDatabaseAndS3BackupRestore(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("ARCBASE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ARCBASE_TEST_DATABASE_URL required")
	}
	targetDSN := "sqlite:" + filepath.Join(t.TempDir(), "restore.db")
	if strings.HasPrefix(dsn, "postgres") {
		admin, err := arcbase.OpenStore(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		defer admin.Close()
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		stamp := time.Now().UnixNano()
		names := []string{fmt.Sprintf("arcbase_cli_%d", stamp), fmt.Sprintf("arcbase_cli_restore_%d", stamp)}
		for _, name := range names {
			if _, err = admin.DB.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
				t.Fatal(err)
			}
			defer admin.DB.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		}
		parsed.Path = "/" + names[0]
		dsn = parsed.String()
		parsed.Path = "/" + names[1]
		targetDSN = parsed.String()
	} else {
		dsn = "sqlite:" + filepath.Join(t.TempDir(), "source.db")
	}
	config := arcbase.Config{DSN: dsn, FileStagingPath: t.TempDir(), StorageEncryptionKey: strings.Repeat("b", 64)}
	for _, cmd := range []string{"migrate", "seed"} {
		if _, err := call(t, config, []string{cmd}, ""); err != nil {
			t.Fatal(err)
		}
	}
	password := "Cli!9143-test-password"
	if _, err := call(t, config, []string{"init-admin", "recovery-admin"}, password+"\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := call(t, config, []string{"reset-admin", "recovery-admin"}, password+"-new\n"); err != nil {
		t.Fatal(err)
	}
	store, err := arcbase.OpenStore(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	account, err := store.Client.User.Query().Where(user.UsernameEQ("recovery-admin")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, access, secret := os.Getenv("ARCBASE_TEST_S3_ENDPOINT"), os.Getenv("ARCBASE_TEST_S3_ACCESS_KEY"), os.Getenv("ARCBASE_TEST_S3_SECRET_KEY")
	if endpoint == "" || access == "" || secret == "" {
		t.Fatal("isolated S3 test endpoint and credentials required")
	}
	api := sdk.NewFromConfig(aws.Config{Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider(access, secret, "")}, func(o *sdk.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	bucket := fmt.Sprintf("arcbase-cli-%d", time.Now().UnixNano())
	objectKey := "original-prefix/nested/file.txt"
	contents := "S3 real snapshot bytes"
	if _, err = api.CreateBucket(ctx, &sdk.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatal(err)
	}
	defer api.DeleteBucket(context.Background(), &sdk.DeleteBucketInput{Bucket: aws.String(bucket)})
	defer api.DeleteObject(context.Background(), &sdk.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(objectKey)})
	if _, err = api.PutObject(ctx, &sdk.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(objectKey), Body: strings.NewReader(contents)}); err != nil {
		t.Fatal(err)
	}
	key, _ := storage.SecretKey(config.StorageEncryptionKey)
	cipher, err := storage.Encrypt(key, secret)
	if err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(config.FileStagingPath, "s3-cache")
	if err = os.MkdirAll(filepath.Join(cache, ".chunks", "upload"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(cache, ".chunks", "upload", "part"), []byte("resumable-part"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(config.FileStagingPath, ".pending-objects"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(config.FileStagingPath, ".pending-objects", "journal"), []byte("private-recovery-record"), 0600); err != nil {
		t.Fatal(err)
	}
	row, err := store.Client.FileStorageConfig.Create().SetName("S3 backup").SetLocalRootPath(cache).SetProvider("s3").SetBasePath("original-prefix").SetS3Region("us-east-1").SetS3Bucket(bucket).SetS3Endpoint(endpoint).SetS3AccessKeyID(access).SetS3SecretCipher(cipher).SetS3ForcePathStyle(true).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(contents))
	if err = store.Client.ManagedFile.Create().SetStorageConfigID(row.ID).SetUploaderID(account.ID).SetOriginalName("file.txt").SetObjectKey(objectKey).SetSize(int64(len(contents))).SetContentHash(hex.EncodeToString(hash[:])).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	store.Close()
	snapshot := filepath.Join(t.TempDir(), "snapshot")
	args := []string{"backup", snapshot}
	if strings.HasPrefix(dsn, "postgres") {
		container := os.Getenv("ARCBASE_ACCEPTANCE_PG_CONTAINER")
		if container != "" {
			args = append(args, "--pg-container", container)
		}
	}
	if _, err = call(t, config, args, ""); err != nil {
		t.Fatal(err)
	}
	target := arcbase.Config{DSN: targetDSN}
	files, env := filepath.Join(t.TempDir(), "files"), filepath.Join(t.TempDir(), "restored.env")
	args = []string{"restore", snapshot, "--files-root", files, "--env-file", env, "--s3-to-local"}
	if strings.HasPrefix(dsn, "postgres") && os.Getenv("ARCBASE_ACCEPTANCE_PG_CONTAINER") != "" {
		args = append(args, "--pg-container", os.Getenv("ARCBASE_ACCEPTANCE_PG_CONTAINER"))
	}
	if _, err = call(t, target, args, ""); err != nil {
		t.Fatal(err)
	}
	recovered, err := arcbase.OpenStore(ctx, targetDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	account, err = recovered.Client.User.Query().Where(user.UsernameEQ("recovery-admin")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password+"-new")); err != nil {
		t.Fatal("administrator hash not preserved")
	}
	configRow, err := recovered.Client.FileStorageConfig.Get(ctx, row.ID)
	if err != nil || configRow.Provider != "local" {
		t.Fatal("S3 local restore", err)
	}
	raw, err := os.ReadFile(filepath.Join(configRow.LocalRootPath, filepath.FromSlash(objectKey)))
	if err != nil || string(raw) != contents {
		t.Fatal("restored object differs", err)
	}
	part, err := os.ReadFile(filepath.Join(configRow.LocalRootPath, ".chunks", "upload", "part"))
	if err != nil || string(part) != "resumable-part" {
		t.Fatal("S3 upload cache not recovered", err)
	}
	if _, err = os.Stat(filepath.Join(files, "staging", ".pending-objects")); !os.IsNotExist(err) {
		t.Fatal("clone can execute source S3 compensation")
	}
	if _, err = os.Stat(filepath.Join(files, "staging", ".source-s3-journal", "journal")); err != nil {
		t.Fatal("private source journal not retained", err)
	}
	if _, err = api.HeadObject(ctx, &sdk.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(objectKey)}); err != nil {
		t.Fatal("source remote object changed", err)
	}
	if _, err = call(t, target, []string{"check"}, ""); err != nil {
		t.Fatal(err)
	}
	t.Log("PASS: real database, administrator recovery, S3 bytes, key/config snapshot and empty-target restore")
}
