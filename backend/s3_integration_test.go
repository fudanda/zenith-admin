//go:build integration

package zenith

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/google/uuid"
)

func (x *extensionFixture) multipart(t *testing.T, path, name string, contents []byte, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		writer.WriteField(key, value)
	}
	field := "file"
	if fields["index"] != "" {
		field = "chunk"
	}
	part, err := writer.CreateFormFile(field, name)
	if err != nil {
		t.Fatal(err)
	}
	part.Write(contents)
	writer.Close()
	request := httptest.NewRequest("POST", "http://zenith.test"+path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-CSRF-Token", x.csrf)
	request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
	response := httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	return response
}
func TestS3RealStorage(t *testing.T) {
	endpoint := os.Getenv("ZENITH_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Fatal("ZENITH_TEST_S3_ENDPOINT required; start isolated MinIO for integration acceptance")
	}
	dsn := os.Getenv("ZENITH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("ZENITH_TEST_DATABASE_URL required")
	}
	dsn = isolatedTestDSN(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	bucket := "zenith-test-" + uuid.NewString()
	access, secret := os.Getenv("ZENITH_TEST_S3_ACCESS_KEY"), os.Getenv("ZENITH_TEST_S3_SECRET_KEY")
	if access == "" || secret == "" {
		t.Fatal("S3 test credentials required")
	}
	api := sdk.NewFromConfig(aws.Config{Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider(access, secret, "")}, func(options *sdk.Options) { options.BaseEndpoint = aws.String(endpoint); options.UsePathStyle = true })
	if _, err := api.CreateBucket(ctx, &sdk.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatal("create bucket", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		items, err := api.ListObjectsV2(ctx, &sdk.ListObjectsV2Input{Bucket: aws.String(bucket)})
		if err == nil {
			for _, item := range items.Contents {
				api.DeleteObject(ctx, &sdk.DeleteObjectInput{Bucket: aws.String(bucket), Key: item.Key})
			}
		}
		api.DeleteBucket(ctx, &sdk.DeleteBucketInput{Bucket: aws.String(bucket)})
	})
	x := extensionFixtureDSN(t, dsn)
	created := x.call("POST", "/api/v1/file-storage-configs", map[string]any{"name": "MinIO test", "provider": "s3", "isDefault": true, "s3Region": "us-east-1", "s3Endpoint": endpoint, "s3Bucket": bucket, "s3AccessKeyId": access, "s3SecretAccessKey": secret, "s3ForcePathStyle": true, "basePath": "acceptance"}, "")
	config := extensionData(t, created)
	id := int(config["id"].(float64))
	configPath := "/api/v1/file-storage-configs/" + strconv.Itoa(id)
	if strings.Contains(created.Body.String(), secret) {
		t.Fatal("storage secret leaked")
	}
	if response := x.call("POST", configPath+"/test", map[string]any{}, ""); response.Code != 200 {
		t.Fatal("test connection", response.Body.String())
	}
	if response := x.call("PUT", configPath, map[string]any{"name": "renamed", "s3SecretAccessKey": ""}, ""); response.Code != 200 {
		t.Fatal("retain secret", response.Body.String())
	}
	saved, err := x.f.Store.Client.FileStorageConfig.Get(ctx, id)
	if err != nil || saved.S3SecretCipher == secret || saved.S3SecretCipher == "" {
		t.Fatal("secret not encrypted", err)
	}
	content := []byte("S3 exact content for private range request")
	file := extensionData(t, x.multipart(t, "/api/v1/files/upload-one?visibility=restricted", "private.txt", content, nil))
	fileID := uuid.MustParse(file["id"].(string))
	fileURL := file["url"].(string)
	if !strings.Contains(file["objectKey"].(string), "acceptance/objects/") {
		t.Fatal("prefix not used")
	}
	request := httptest.NewRequest("GET", "http://zenith.test"+fileURL, nil)
	request.AddCookie(&http.Cookie{Name: "zenith_session", Value: x.token})
	request.Header.Set("Range", "bytes=3-7")
	response := httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 206 || !bytes.Equal(response.Body.Bytes(), content[3:8]) {
		t.Fatal("ranged read", response.Code, response.Body.String())
	}
	request = httptest.NewRequest("GET", "http://zenith.test"+fileURL, nil)
	response = httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("private download was public")
	}
	limitedKey := x.key(t, "system:position:list")
	if denied := x.call("GET", fileURL, nil, limitedKey); denied.Code != 403 {
		t.Fatal("private download bypassed key scope", denied.Code)
	}
	downloadKey := x.key(t, "system:file:download")
	if allowed := x.call("GET", fileURL, nil, downloadKey); allowed.Code != 200 || !bytes.Equal(allowed.Body.Bytes(), content) {
		t.Fatal("granted key download failed", allowed.Code)
	}
	public := extensionData(t, x.multipart(t, "/api/v1/files/upload-one", "public.txt", []byte("public S3"), nil))
	request = httptest.NewRequest("GET", "http://zenith.test"+public["url"].(string), nil)
	response = httptest.NewRecorder()
	x.f.Handler().ServeHTTP(response, request)
	if response.Code != 200 || response.Body.String() != "public S3" {
		t.Fatal("public proxy read", response.Code)
	}
	init := extensionData(t, x.call("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "chunks.txt", "fileSize": 6 << 20, "chunkSize": 5 << 20, "visibility": "restricted"}, ""))
	uploadID := init["uploadId"].(string)
	for i, size := range []int{5 << 20, 1 << 20} {
		response := x.multipart(t, "/api/v1/files/upload/chunk", "part", bytes.Repeat([]byte("A"), size), map[string]string{"uploadId": uploadID, "index": fmt.Sprint(i)})
		if response.Code != 200 {
			t.Fatal("chunk", i, response.Body.String())
		}
	}
	complete := extensionData(t, x.call("POST", "/api/v1/files/upload/complete", map[string]any{"uploadId": uploadID}, ""))
	if complete["size"].(float64) != 6<<20 {
		t.Fatal("chunk completion size")
	}
	cancelUpload := extensionData(t, x.call("POST", "/api/v1/files/upload/init", map[string]any{"fileName": "abort.txt", "fileSize": 1, "chunkSize": 5 << 20}, ""))
	if x.call("DELETE", "/api/v1/files/upload/"+cancelUpload["uploadId"].(string), nil, "").Code != 200 {
		t.Fatal("abort")
	}
	if x.call("PUT", configPath, map[string]any{"s3Bucket": "changed"}, "").Code != 409 {
		t.Fatal("moved live bucket")
	}
	// Failed deletion retains metadata for the maintenance retry.
	x.f.Store.Client.FileStorageConfig.UpdateOneID(id).SetS3SecretCipher("invalid").Exec(ctx)
	failed := x.call("DELETE", "/api/v1/files/"+fileID.String(), nil, "")
	if failed.Code != 503 {
		t.Fatal("deletion failure hidden", failed.Code)
	}
	pending, err := x.f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(fileID), managedfile.DeletePending(true)).Only(ctx)
	if err != nil || pending == nil {
		t.Fatal("metadata deleted before bytes", err)
	}
	x.f.Store.Client.FileStorageConfig.UpdateOneID(id).SetS3SecretCipher(saved.S3SecretCipher).Exec(ctx)
	if err = x.f.services.files.RetryPendingFileDeletes(ctx); err != nil {
		t.Fatal(err)
	}
	if x.f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(fileID)).ExistX(ctx) {
		t.Fatal("delete retry ineffective")
	}
	row, err := x.f.Store.Client.ManagedFile.Get(ctx, uuid.MustParse(complete["id"].(string)))
	if err != nil {
		t.Fatal(err)
	}
	object, err := api.GetObject(ctx, &sdk.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(row.ObjectKey)})
	if err != nil {
		t.Fatal(err)
	}
	total, err := io.Copy(io.Discard, object.Body)
	object.Body.Close()
	if err != nil || total != 6<<20 {
		t.Fatal("remote object truncated", total, err)
	}
	// A metadata transaction failure plus remote deletion failure must leave a
	// durable encrypted compensation job, independent of the config's lifetime.
	upstream, _ := url.Parse(endpoint)
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	var blockDelete atomic.Bool
	blockDelete.Store(true)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" && blockDelete.Load() {
			w.WriteHeader(403)
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	defer gateway.Close()
	failureConfig := extensionData(t, x.call("POST", "/api/v1/file-storage-configs", map[string]any{"name": "failure compensation", "provider": "s3", "isDefault": true, "s3Region": "us-east-1", "s3Endpoint": gateway.URL, "s3Bucket": bucket, "s3AccessKeyId": access, "s3SecretAccessKey": secret, "s3ForcePathStyle": true, "basePath": "rollback"}, ""))
	x.f.Store.Client.ManagedFile.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if mutation.Op().Is(ent.OpCreate) {
				return nil, errors.New("injected metadata rollback")
			}
			return next.Mutate(ctx, mutation)
		})
	})
	before := x.f.Store.Client.ManagedFile.Query().CountX(ctx)
	failedUpload := x.multipart(t, "/api/v1/files/upload-one", "rollback.txt", []byte("must be cleaned"), nil)
	if failedUpload.Code < 400 || x.f.Store.Client.ManagedFile.Query().CountX(ctx) != before {
		t.Fatal("failed upload pretended success")
	}
	jobs, err := filepath.Glob(filepath.Join(x.f.config.FileStagingPath, ".pending-objects", "*.json"))
	if err != nil || len(jobs) != 1 {
		t.Fatal("missing durable compensation", jobs, err)
	}
	payload, _ := os.ReadFile(jobs[0])
	if bytes.Contains(payload, []byte(secret)) {
		t.Fatal("journal exposed storage secret")
	}
	rollbackObjects, err := api.ListObjectsV2(ctx, &sdk.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String("rollback/")})
	if err != nil || len(rollbackObjects.Contents) != 1 {
		t.Fatal("failure fixture did not create remote object", err)
	}
	configID := strconv.Itoa(int(failureConfig["id"].(float64)))
	if x.call("DELETE", "/api/v1/file-storage-configs/"+configID, nil, "").Code != 200 {
		t.Fatal("empty config not removable")
	}
	configSnapshot := x.f.config
	if err := x.f.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(ctx, configSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Shutdown(context.Background())
	blockDelete.Store(false)
	if err := restarted.services.files.RetryPendingFileDeletes(ctx); err != nil {
		t.Fatal(err)
	}
	rollbackObjects, err = api.ListObjectsV2(ctx, &sdk.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String("rollback/")})
	if err != nil || len(rollbackObjects.Contents) != 0 {
		t.Fatal("restart did not clean orphaned object", err)
	}
	if _, err = os.Stat(jobs[0]); !os.IsNotExist(err) {
		t.Fatal("completed job not removed", err)
	}
}
