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

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	s3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

func TestIntegrationOriginalPages(t *testing.T) {
	node := os.Getenv("ZENITH_BROWSER_TEST_NODE")
	if node == "" {
		t.Skip("set ZENITH_BROWSER_TEST_NODE for original integration page acceptance")
	}
	dsn, endpoint := os.Getenv("ZENITH_TEST_DATABASE_URL"), os.Getenv("ZENITH_TEST_S3_ENDPOINT")
	if dsn == "" || endpoint == "" {
		t.Fatal("isolated database and S3 test endpoint required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	x := extensionFixtureDSN(t, isolatedTestDSN(t, dsn))
	peerPassword, err := secret()
	if err != nil {
		t.Fatal(err)
	}
	if err := x.f.Store.InitAdmin(ctx, "realtime-peer", peerPassword); err != nil {
		t.Fatal(err)
	}
	access, secretKey := os.Getenv("ZENITH_TEST_S3_ACCESS_KEY"), os.Getenv("ZENITH_TEST_S3_SECRET_KEY")
	if access == "" || secretKey == "" {
		t.Fatal("S3 test credentials required")
	}
	api := s3.NewFromConfig(aws.Config{Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider(access, secretKey, "")}, func(o *s3.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	bucket := "zenith-browser-" + uuid.NewString()
	if _, err := api.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		objects, err := api.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(bucket)})
		if err == nil {
			for _, object := range objects.Contents {
				api.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: object.Key})
			}
		}
		api.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: aws.String(bucket)})
	})
	server := httptest.NewServer(x.f.Handler())
	defer server.Close()
	script, err := filepath.Abs("../packages/web/scripts/integrations-smoke.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, node, script)
	cmd.Env = append(os.Environ(), "ZENITH_BROWSER_API_URL="+server.URL, "ZENITH_BROWSER_USERNAME=extension-admin", "ZENITH_BROWSER_PASSWORD="+x.password, "ZENITH_BROWSER_PEER_PASSWORD="+peerPassword, "ZENITH_BROWSER_S3_BUCKET="+bucket)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("original integration pages: %v\n%s", err, output)
	}
	t.Log(string(output))
}
