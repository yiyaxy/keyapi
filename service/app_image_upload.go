package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/service/ticket_storage"
	"github.com/QuantumNous/new-api/types"
)

type AppImagePresignUploadResult struct {
	ObjectKey       string
	UploadURL       string
	ObjectURL       string
	RequiredHeaders map[string]string
	ExpiresAt       int64
}

type AppImagePresignUploadItem struct {
	Filename    string
	ContentType string
	SizeBytes   int64
}

const appImageStorageDuration = 7 * 24 * time.Hour

func AppImagePresignUpload(ctx context.Context, tenantId int, userID int, filename, contentType string, sizeBytes int64) (*AppImagePresignUploadResult, error) {
	if userID <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	filename = strings.TrimSpace(filename)
	contentType = strings.TrimSpace(contentType)
	if filename == "" || contentType == "" || sizeBytes <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid filename/contentType/sizeBytes"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := ensureImageContentType(contentType); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if sizeBytes > maxTicketAttachmentBytes() {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("file too large"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, err
	}

	randomSuffix, err := secureRandomBase62(16)
	if err != nil {
		return nil, err
	}
	now := nowTimestamp()
	ext := sanitizeTicketAttachmentExt(filename)
	objectKey := fmt.Sprintf("app-image/%d/%d/%d_%s%s", tenantId, userID, now, randomSuffix, ext)
	uploadURL, requiredHeaders, expiresAt, err := client.PresignUpload(objectKey, contentType, ticketStoragePresignExpire())
	if err != nil {
		return nil, err
	}
	objectURL, _, err := client.PresignGet(objectKey, appImageStorageDuration)
	if err != nil {
		return nil, err
	}

	return &AppImagePresignUploadResult{
		ObjectKey:       objectKey,
		UploadURL:       uploadURL,
		ObjectURL:       objectURL,
		RequiredHeaders: requiredHeaders,
		ExpiresAt:       expiresAt.Unix(),
	}, nil
}

func AppImageUpload(ctx context.Context, tenantId int, userID int, filename, contentType string, body []byte) (*AppImagePresignUploadResult, error) {
	if userID <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	filename = strings.TrimSpace(filename)
	contentType = strings.TrimSpace(contentType)
	if filename == "" || len(body) == 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid filename/body"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if contentType == "" {
		contentType = http.DetectContentType(body)
	}
	if err := ensureImageContentType(contentType); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if int64(len(body)) > maxTicketAttachmentBytes() {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("file too large"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, err
	}

	randomSuffix, err := secureRandomBase62(16)
	if err != nil {
		return nil, err
	}
	now := nowTimestamp()
	ext := sanitizeTicketAttachmentExt(filename)
	objectKey := fmt.Sprintf("app-image/%d/%d/%d_%s%s", tenantId, userID, now, randomSuffix, ext)
	if err := client.UploadObject(ctx, objectKey, contentType, body); err != nil {
		return nil, err
	}
	objectURL, expiresAt, err := client.PresignGet(objectKey, appImageStorageDuration)
	if err != nil {
		return nil, err
	}

	return &AppImagePresignUploadResult{
		ObjectKey: objectKey,
		ObjectURL: objectURL,
		ExpiresAt: expiresAt.Unix(),
	}, nil
}

func AppImagePresignUploadBatch(ctx context.Context, tenantId int, userID int, items []AppImagePresignUploadItem) ([]*AppImagePresignUploadResult, error) {
	if len(items) == 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("items is required"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if len(items) > 20 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("too many files"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	results := make([]*AppImagePresignUploadResult, 0, len(items))
	for _, item := range items {
		result, err := AppImagePresignUpload(ctx, tenantId, userID, item.Filename, item.ContentType, item.SizeBytes)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}
