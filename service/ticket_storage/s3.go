package ticket_storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Client is a minimal interface for ticket attachment storage.
// It is intentionally provider-agnostic (S3-compatible).
//
// Note: objectKey should be the final object key within the bucket.
// Callers are responsible for choosing a deterministic naming scheme.

type PresignGetResponseOptions struct {
	ContentDisposition string
	ContentType        string
}

type Client interface {
	PresignUpload(objectKey, contentType string, expires time.Duration) (url string, headers map[string]string, expiresAt time.Time, err error)
	UploadObject(ctx context.Context, objectKey, contentType string, body []byte) error
	HeadObject(objectKey string) (size int64, contentType string, err error)
	DeleteObject(ctx context.Context, objectKey string) error
	PresignGet(objectKey string, expires time.Duration) (url string, expiresAt time.Time, err error)
	PresignGetWithResponse(ctx context.Context, objectKey string, expires time.Duration, resp PresignGetResponseOptions) (url string, expiresAt time.Time, err error)
}

const (
	ObjectURLScheme = "storage://"

	optionBucket         = "ticket_storage.bucket"
	optionRegion         = "ticket_storage.region"
	optionEndpoint       = "ticket_storage.endpoint"
	optionForcePathStyle = "ticket_storage.force_path_style"
	optionPrefix         = "ticket_storage.prefix"

	optionAccessKey = "ticket_storage.access_key"
	optionSecretKey = "ticket_storage.secret_key"
)

func ObjectURL(objectKey string) string {
	objectKey = strings.TrimSpace(objectKey)
	objectKey = strings.TrimPrefix(objectKey, "/")
	if objectKey == "" {
		return ""
	}
	return ObjectURLScheme + objectKey
}

func ObjectKeyFromURL(rawURL string) (string, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if !strings.HasPrefix(rawURL, ObjectURLScheme) {
		return "", false
	}
	objectKey := strings.TrimSpace(strings.TrimPrefix(rawURL, ObjectURLScheme))
	objectKey = strings.TrimPrefix(objectKey, "/")
	return objectKey, objectKey != ""
}

type s3Client struct {
	bucket   string
	prefix   string
	client   *s3.Client
	presign  *s3.PresignClient
	endpoint string
}

func (c *s3Client) PresignUpload(objectKey, contentType string, expires time.Duration) (string, map[string]string, time.Time, error) {
	key := c.fullKey(objectKey)
	if strings.TrimSpace(key) == "" {
		return "", nil, time.Time{}, fmt.Errorf("objectKey is required")
	}

	input := &s3.PutObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}
	if strings.TrimSpace(contentType) != "" {
		input.ContentType = aws.String(contentType)
	}

	ctx := context.Background()
	out, err := c.presign.PresignPutObject(ctx, input, func(o *s3.PresignOptions) {
		o.Expires = expires
	})
	if err != nil {
		return "", nil, time.Time{}, fmt.Errorf("presign put object: %w", err)
	}

	expiresAt := time.Now().Add(expires)
	headers := map[string]string{}
	if strings.TrimSpace(contentType) != "" {
		headers["Content-Type"] = contentType
	}
	return out.URL, headers, expiresAt, nil
}

func (c *s3Client) UploadObject(ctx context.Context, objectKey, contentType string, body []byte) error {
	key := c.fullKey(objectKey)
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("objectKey is required")
	}
	if len(body) == 0 {
		return fmt.Errorf("body is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	// Use presigned PUT URL to avoid chunked-encoding issues with OSS providers
	ct := strings.TrimSpace(contentType)
	if ct == "" {
		ct = "application/octet-stream"
	}
	presignURL, _, _, err := c.PresignUpload(objectKey, ct, 5*time.Minute)
	if err != nil {
		return fmt.Errorf("presign upload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, presignURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build upload request: %w", err)
	}
	req.Header.Set("Content-Type", ct)
	req.ContentLength = int64(len(body))
	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload request: %w", err)
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(httpResp.Body, 4096))
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			return fmt.Errorf("upload http status %d", httpResp.StatusCode)
		}
		return fmt.Errorf("upload http status %d: %s", httpResp.StatusCode, msg)
	}
	return nil
}

func (c *s3Client) HeadObject(objectKey string) (int64, string, error) {
	key := c.fullKey(objectKey)
	if strings.TrimSpace(key) == "" {
		return 0, "", fmt.Errorf("objectKey is required")
	}

	ctx := context.Background()
	out, err := c.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return 0, "", fmt.Errorf("head object: %w", err)
	}

	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}

	contentType := ""
	if out.ContentType != nil {
		contentType = *out.ContentType
	}
	return size, contentType, nil
}

func (c *s3Client) DeleteObject(ctx context.Context, objectKey string) error {
	key := c.fullKey(objectKey)
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("objectKey is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

func (c *s3Client) PresignGet(objectKey string, expires time.Duration) (string, time.Time, error) {
	return c.PresignGetWithResponse(context.Background(), objectKey, expires, PresignGetResponseOptions{})
}

func (c *s3Client) PresignGetWithResponse(ctx context.Context, objectKey string, expires time.Duration, resp PresignGetResponseOptions) (string, time.Time, error) {
	key := c.fullKey(objectKey)
	if strings.TrimSpace(key) == "" {
		return "", time.Time{}, fmt.Errorf("objectKey is required")
	}

	input := &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}
	if strings.TrimSpace(resp.ContentDisposition) != "" {
		input.ResponseContentDisposition = aws.String(resp.ContentDisposition)
	}
	// Note: ResponseContentType is NOT set here because Alibaba Cloud OSS
	// does not support overriding content-type on presigned GET requests
	// (error 0017-00000902). The object's original content-type (set at
	// upload time) is used instead.

	out, err := c.presign.PresignGetObject(ctx, input, func(o *s3.PresignOptions) {
		o.Expires = expires
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("presign get object: %w", err)
	}

	return out.URL, time.Now().Add(expires), nil
}

func (c *s3Client) fullKey(objectKey string) string {
	key := strings.TrimSpace(objectKey)
	key = strings.TrimPrefix(key, "/")
	if c.prefix == "" {
		return key
	}
	p := strings.TrimSpace(c.prefix)
	p = strings.TrimPrefix(p, "/")
	p = strings.TrimSuffix(p, "/")
	if p == "" {
		return key
	}
	if key == "" {
		return p
	}
	return p + "/" + key
}

func getOption(key string) string {
	common.OptionMapRWMutex.RLock()
	v := common.OptionMap[key]
	common.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(v)
}

func parseBool(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	switch v {
	case "true", "1", "yes", "y", "on":
		return true
	default:
		return false
	}
}

type s3Options struct {
	bucket         string
	region         string
	endpoint       string
	forcePathStyle bool
	prefix         string
	accessKey      string
	secretKey      string
}

func loadS3OptionsFromOptionMap() *s3Options {
	return &s3Options{
		bucket:         getOption(optionBucket),
		region:         getOption(optionRegion),
		endpoint:       getOption(optionEndpoint),
		forcePathStyle: parseBool(getOption(optionForcePathStyle)),
		prefix:         getOption(optionPrefix),
		accessKey:      getOption(optionAccessKey),
		secretKey:      getOption(optionSecretKey),
	}
}

func (o *s3Options) cacheKey() string {
	// Do NOT include secret material verbatim in logs; this string is only used in-memory.
	return strings.Join([]string{
		o.bucket,
		o.region,
		o.endpoint,
		fmt.Sprintf("%v", o.forcePathStyle),
		o.prefix,
		o.accessKey,
		o.secretKey,
	}, "|")
}

func (o *s3Options) validate() error {
	if o.bucket == "" {
		return fmt.Errorf("%s is required", optionBucket)
	}
	if o.region == "" {
		// For S3-compatible providers, a static region is still required for SigV4.
		return fmt.Errorf("%s is required", optionRegion)
	}
	if o.endpoint == "" {
		// For Aliyun OSS, the virtual-host endpoint is typically:
		// https://{bucket}.{region}.aliyuncs.com
		//
		// If forcePathStyle is enabled, callers must provide an endpoint explicitly
		// (usually without the bucket prefix), otherwise requests may end up with
		// duplicated bucket segments.
		if o.forcePathStyle {
			return fmt.Errorf("%s is required when %s is true", optionEndpoint, optionForcePathStyle)
		}
		o.endpoint = fmt.Sprintf("https://%s.%s.aliyuncs.com", o.bucket, o.region)
	}
	if o.accessKey == "" {
		return fmt.Errorf("%s is required", optionAccessKey)
	}
	if o.secretKey == "" {
		return fmt.Errorf("%s is required", optionSecretKey)
	}
	return nil
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", fmt.Errorf("empty endpoint")
	}
	// Accept bare host:port by assuming https.
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" {
		return "", fmt.Errorf("endpoint scheme is required")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("endpoint host is required")
	}
	// Keep path if the user intentionally provided it.
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func newS3ClientFromOptions(o *s3Options) (Client, error) {
	if err := o.validate(); err != nil {
		return nil, err
	}
	endpoint, err := normalizeEndpoint(o.endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid %s: %w", optionEndpoint, err)
	}

	credProvider := aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(o.accessKey, o.secretKey, ""))

	resolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		if service == s3.ServiceID {
			return aws.Endpoint{
				URL:               endpoint,
				SigningRegion:     o.region,
				HostnameImmutable: true,
			}, nil
		}
		return aws.Endpoint{}, &aws.EndpointNotFoundError{}
	})

	cfg, err := config.LoadDefaultConfig(
		context.Background(),
		config.WithRegion(o.region),
		config.WithCredentialsProvider(credProvider),
		config.WithEndpointResolverWithOptions(resolver),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	s3Svc := s3.NewFromConfig(cfg, func(opt *s3.Options) {
		opt.UsePathStyle = o.forcePathStyle
	})

	return &s3Client{
		bucket:   o.bucket,
		prefix:   o.prefix,
		client:   s3Svc,
		presign:  s3.NewPresignClient(s3Svc),
		endpoint: endpoint,
	}, nil
}

var (
	cachedMu       sync.Mutex
	cachedClient   Client
	cachedClientCK string
)

// GetClient returns a cached S3-compatible client initialized from option keys.
// It auto-refreshes when the underlying option values change.
func GetClient() (Client, error) {
	opts := loadS3OptionsFromOptionMap()
	ck := opts.cacheKey()

	cachedMu.Lock()
	defer cachedMu.Unlock()

	if cachedClient != nil && ck == cachedClientCK {
		return cachedClient, nil
	}

	client, err := newS3ClientFromOptions(opts)
	if err != nil {
		return nil, err
	}
	cachedClient = client
	cachedClientCK = ck
	return cachedClient, nil
}
