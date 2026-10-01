// Package s3 implements S3-compatible object bytes. Staging stays on local
// confined roots; private objects are never redirected around Go authorization.
package s3

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type Config struct {
	Region, Endpoint, Bucket, AccessKeyID, Secret string
	ForcePathStyle                                bool
}

func Validate(c Config) error {
	if c.Region == "" || c.Bucket == "" || c.AccessKeyID == "" || c.Secret == "" {
		return errors.New("S3 Region、Bucket 和凭据不能为空")
	}
	if strings.ContainsAny(c.Bucket, "/\\ ?#\r\n") || len(c.Bucket) > 255 || len(c.Region) > 255 || len(c.AccessKeyID) > 255 || len(c.Secret) > 128 {
		return errors.New("S3 配置字段无效")
	}
	if c.Endpoint != "" {
		u, e := url.Parse(c.Endpoint)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || len(c.Endpoint) > 255 {
			return errors.New("Endpoint 必须为 HTTP/HTTPS 源地址")
		}
	}
	return nil
}
func ValidatePrefix(prefix string) error {
	if len(prefix) > 128 || strings.ContainsAny(prefix, "\\\r\n") || strings.HasPrefix(prefix, "/") || prefix != "" && path.Clean(prefix) != prefix || prefix == ".." || strings.HasPrefix(prefix, "../") {
		return errors.New("对象前缀无效")
	}
	return nil
}

type Client struct {
	api    *sdk.Client
	bucket string
}

func New(c Config) (*Client, error) {
	if err := Validate(c); err != nil {
		return nil, err
	}
	cfg := aws.Config{Region: c.Region, Credentials: credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.Secret, ""), RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired, ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired, RetryMaxAttempts: 2}
	api := sdk.NewFromConfig(cfg, func(o *sdk.Options) {
		o.UsePathStyle = c.ForcePathStyle
		if c.Endpoint != "" {
			o.BaseEndpoint = aws.String(c.Endpoint)
		}
	})
	return &Client{api: api, bucket: c.Bucket}, nil
}
func (c *Client) Put(ctx context.Context, key string, reader io.ReadSeeker, size int64, mime string) error {
	_, err := c.api.PutObject(ctx, &sdk.PutObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key), Body: reader, ContentLength: aws.Int64(size), ContentType: aws.String(mime)})
	return err
}
func (c *Client) Remove(ctx context.Context, key string) error {
	_, err := c.api.DeleteObject(ctx, &sdk.DeleteObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)})
	return err
}
func (c *Client) Test(ctx context.Context) error {
	_, err := c.api.HeadBucket(ctx, &sdk.HeadBucketInput{Bucket: aws.String(c.bucket)})
	return err
}

type Reader struct {
	client       *Client
	ctx          context.Context
	key          string
	size, offset int64
	body         io.ReadCloser
	Modified     time.Time
}

func (c *Client) Open(ctx context.Context, key string) (*Reader, error) {
	head, err := c.api.HeadObject(ctx, &sdk.HeadObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)})
	if err != nil {
		var failure smithy.APIError
		if errors.As(err, &failure) && (failure.ErrorCode() == "NotFound" || failure.ErrorCode() == "NoSuchKey") {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	reader := &Reader{client: c, ctx: ctx, key: key, size: aws.ToInt64(head.ContentLength)}
	if head.LastModified != nil {
		reader.Modified = *head.LastModified
	}
	return reader, nil
}
func (r *Reader) Read(p []byte) (int, error) {
	if r.offset >= r.size {
		return 0, io.EOF
	}
	if r.body == nil {
		response, err := r.client.api.GetObject(r.ctx, &sdk.GetObjectInput{Bucket: aws.String(r.client.bucket), Key: aws.String(r.key), Range: aws.String(fmt.Sprintf("bytes=%d-", r.offset))})
		if err != nil {
			return 0, err
		}
		r.body = response.Body
	}
	n, err := r.body.Read(p)
	r.offset += int64(n)
	return n, err
}
func (r *Reader) Seek(offset int64, whence int) (int64, error) {
	next := offset
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		next += r.offset
	case io.SeekEnd:
		next += r.size
	default:
		return 0, errors.New("invalid seek")
	}
	if next < 0 {
		return 0, errors.New("negative seek")
	}
	if next != r.offset {
		r.Close()
		r.offset = next
	}
	return r.offset, nil
}
func (r *Reader) Close() error {
	if r.body != nil {
		err := r.body.Close()
		r.body = nil
		return err
	}
	return nil
}
