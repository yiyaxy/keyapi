package ticket

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	"github.com/gin-gonic/gin"
)

type TicketStorageSecretUpsertRequest struct {
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
}

const (
	ticketStorageAccessKeyOptionKey = "ticket_storage.access_key"
	ticketStorageSecretKeyOptionKey = "ticket_storage.secret_key"
)

// UpsertTicketStorageSecret handles PUT /api/ticket_storage/secret (AdminAuth)
// Body: {access_key, secret_key}
//
// This endpoint is write-only: it never returns stored secrets.
func UpsertTicketStorageSecret(c *gin.Context) {
	var req TicketStorageSecretUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.AccessKey) == "" || strings.TrimSpace(req.SecretKey) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	if err := model.UpdateOption(ticketStorageAccessKeyOptionKey, strings.TrimSpace(req.AccessKey)); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(ticketStorageSecretKeyOptionKey, strings.TrimSpace(req.SecretKey)); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{})
}

// TestTicketStorageUpload handles POST /api/ticket_storage/test.
// It writes a small probe object and verifies it with HeadObject.
func TestTicketStorageUpload(c *gin.Context) {
	startedAt := time.Now()
	common.SysLog("ticket_storage test upload started")

	client, err := ticket_storage.GetClient()
	if err != nil {
		common.SysError("ticket_storage test upload init client failed: " + err.Error())
		common.ApiError(c, err)
		return
	}
	common.SysLog(fmt.Sprintf("ticket_storage test upload client ready elapsed_ms=%d", time.Since(startedAt).Milliseconds()))

	now := time.Now()
	objectKey := fmt.Sprintf(
		"storage-tests/%s/test-%d.txt",
		now.Format("20060102"),
		now.UnixNano(),
	)
	body := []byte("new-api ticket_storage upload test\n")
	contentType := "text/plain; charset=utf-8"

	uploadStartedAt := time.Now()
	common.SysLog(fmt.Sprintf(
		"ticket_storage test upload put start object_key=%s content_type=%q size_bytes=%d",
		objectKey,
		contentType,
		len(body),
	))
	if err := client.UploadObject(c.Request.Context(), objectKey, contentType, body); err != nil {
		common.SysError(fmt.Sprintf(
			"ticket_storage test upload put failed object_key=%s elapsed_ms=%d error=%s",
			objectKey,
			time.Since(uploadStartedAt).Milliseconds(),
			err.Error(),
		))
		common.ApiError(c, err)
		return
	}
	common.SysLog(fmt.Sprintf(
		"ticket_storage test upload put success object_key=%s elapsed_ms=%d",
		objectKey,
		time.Since(uploadStartedAt).Milliseconds(),
	))

	headStartedAt := time.Now()
	common.SysLog(fmt.Sprintf("ticket_storage test upload head start object_key=%s", objectKey))
	size, detectedContentType, err := client.HeadObject(objectKey)
	if err != nil {
		common.SysError(fmt.Sprintf(
			"ticket_storage test upload head failed object_key=%s elapsed_ms=%d error=%s",
			objectKey,
			time.Since(headStartedAt).Milliseconds(),
			err.Error(),
		))
		common.ApiError(c, err)
		return
	}
	if size != int64(len(body)) {
		err := fmt.Errorf("uploaded object size mismatch: got %d, want %d", size, len(body))
		common.SysError(fmt.Sprintf(
			"ticket_storage test upload verify failed object_key=%s elapsed_ms=%d error=%s",
			objectKey,
			time.Since(headStartedAt).Milliseconds(),
			err.Error(),
		))
		common.ApiError(c, err)
		return
	}
	common.SysLog(fmt.Sprintf(
		"ticket_storage test upload head success object_key=%s size_bytes=%d content_type=%q elapsed_ms=%d total_elapsed_ms=%d",
		objectKey,
		size,
		detectedContentType,
		time.Since(headStartedAt).Milliseconds(),
		time.Since(startedAt).Milliseconds(),
	))

	common.ApiSuccess(c, gin.H{
		"object_key":   objectKey,
		"size_bytes":   size,
		"content_type": detectedContentType,
	})
}
