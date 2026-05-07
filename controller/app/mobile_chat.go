package app

import (
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type appImagePresignUploadRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

type appImagePresignUploadBatchRequest struct {
	Items []appImagePresignUploadRequest `json:"items"`
}

type appImagePresignUploadResponse struct {
	ObjectKey        string            `json:"object_key"`
	UploadURL        string            `json:"upload_url"`
	ObjectURL        string            `json:"object_url"`
	RequiredHeaders  map[string]string `json:"required_headers"`
	ExpiresAtUnixSec int64             `json:"expires_at"`
}

type appImagePresignUploadBatchResponse struct {
	Items []appImagePresignUploadResponse `json:"items"`
}

type appImageUploadResponse struct {
	ObjectKey        string `json:"object_key"`
	ObjectURL        string `json:"object_url"`
	ExpiresAtUnixSec int64  `json:"expires_at"`
}

type appImageUploadBatchResponse struct {
	Items []appImageUploadResponse `json:"items"`
}

type mobileChatMessageRequest struct {
	Role             string   `json:"role"`
	Kind             string   `json:"kind"`
	Model            string   `json:"model"`
	ModelDisplayName string   `json:"model_display_name"`
	Content          string   `json:"content"`
	Images           []string `json:"images"`
	CreatedAt        int64    `json:"created_at"`
}

type mobileChatMessageResponse struct {
	Id               int      `json:"id"`
	Role             string   `json:"role"`
	Kind             string   `json:"kind"`
	Model            string   `json:"model"`
	ModelDisplayName string   `json:"model_display_name"`
	Content          string   `json:"content"`
	Images           []string `json:"images"`
	CreatedAt        int64    `json:"created_at"`
	ExpiresAt        int64    `json:"expires_at"`
}

func PresignAppImageUpload(c *gin.Context) {
	var req appImagePresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Filename) == "" || strings.TrimSpace(req.ContentType) == "" || req.SizeBytes <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	result, err := service.AppImagePresignUpload(c.Request.Context(), middleware.GetTenantId(c), c.GetInt("id"), req.Filename, req.ContentType, req.SizeBytes)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, appImagePresignUploadResponse{
		ObjectKey:        result.ObjectKey,
		UploadURL:        result.UploadURL,
		ObjectURL:        result.ObjectURL,
		RequiredHeaders:  result.RequiredHeaders,
		ExpiresAtUnixSec: result.ExpiresAt,
	})
}

func PresignAppImageUploadBatch(c *gin.Context) {
	var req appImagePresignUploadBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Items) == 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	items := make([]service.AppImagePresignUploadItem, 0, len(req.Items))
	for _, item := range req.Items {
		if strings.TrimSpace(item.Filename) == "" || strings.TrimSpace(item.ContentType) == "" || item.SizeBytes <= 0 {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
		items = append(items, service.AppImagePresignUploadItem{
			Filename:    item.Filename,
			ContentType: item.ContentType,
			SizeBytes:   item.SizeBytes,
		})
	}

	results, err := service.AppImagePresignUploadBatch(c.Request.Context(), middleware.GetTenantId(c), c.GetInt("id"), items)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	resp := appImagePresignUploadBatchResponse{
		Items: make([]appImagePresignUploadResponse, 0, len(results)),
	}
	for _, result := range results {
		resp.Items = append(resp.Items, appImagePresignUploadResponse{
			ObjectKey:        result.ObjectKey,
			UploadURL:        result.UploadURL,
			ObjectURL:        result.ObjectURL,
			RequiredHeaders:  result.RequiredHeaders,
			ExpiresAtUnixSec: result.ExpiresAt,
		})
	}
	common.ApiSuccess(c, resp)
}

func UploadAppImages(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	files := form.File["files"]
	if len(files) == 0 {
		files = form.File["file"]
	}
	if len(files) == 0 || len(files) > 20 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	resp := appImageUploadBatchResponse{
		Items: make([]appImageUploadResponse, 0, len(files)),
	}
	for _, header := range files {
		if header == nil || strings.TrimSpace(header.Filename) == "" || header.Size <= 0 {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
		file, err := header.Open()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		body, readErr := io.ReadAll(file)
		_ = file.Close()
		if readErr != nil {
			common.ApiError(c, readErr)
			return
		}
		contentType := header.Header.Get("Content-Type")
		result, err := service.AppImageUpload(c.Request.Context(), middleware.GetTenantId(c), c.GetInt("id"), header.Filename, contentType, body)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		resp.Items = append(resp.Items, appImageUploadResponse{
			ObjectKey:        result.ObjectKey,
			ObjectURL:        result.ObjectURL,
			ExpiresAtUnixSec: result.ExpiresAt,
		})
	}
	common.ApiSuccess(c, resp)
}

func ListMobileChatMessages(c *gin.Context) {
	nowMs := time.Now().UnixMilli()
	_ = model.DeleteExpiredMobileChatMessages(nowMs)

	kind := normalizeMobileChatKind(c.Query("kind"))
	limit := parseMobileChatInt(c.Query("limit"), 100)
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	offset := parseMobileChatInt(c.Query("offset"), 0)
	desc := c.Query("order") == "desc"
	records, err := model.ListMobileChatMessages(middleware.GetTenantId(c), c.GetInt("id"), kind, nowMs, limit+1, offset, desc)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	hasMore := len(records) > limit
	if hasMore {
		records = records[:limit]
	}

	items := make([]mobileChatMessageResponse, 0, len(records))
	for _, record := range records {
		items = append(items, mobileChatMessageToResponse(record))
	}
	common.ApiSuccess(c, gin.H{"items": items, "has_more": hasMore})
}

func ClearMobileChatMessages(c *gin.Context) {
	kind := normalizeMobileChatKind(c.Query("kind"))
	if err := model.DeleteMobileChatMessages(middleware.GetTenantId(c), c.GetInt("id"), kind); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{"ok": true})
}

func SaveMobileChatMessage(c *gin.Context) {
	var req mobileChatMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}

	req.Role = strings.TrimSpace(req.Role)
	req.Kind = strings.TrimSpace(req.Kind)
	req.Model = strings.TrimSpace(req.Model)
	req.ModelDisplayName = strings.TrimSpace(req.ModelDisplayName)
	req.Content = strings.TrimSpace(req.Content)
	if req.Role != "user" && req.Role != "assistant" {
		common.ApiErrorMsg(c, "invalid role")
		return
	}
	req.Kind = normalizeMobileChatKind(req.Kind)
	if req.Kind == "" {
		req.Kind = "chat"
	}
	if req.Content == "" && len(req.Images) == 0 {
		common.ApiErrorMsg(c, "content or images is required")
		return
	}

	nowMs := time.Now().UnixMilli()
	createdAt := req.CreatedAt
	if createdAt <= 0 {
		createdAt = nowMs
	}

	imageBytes, err := common.Marshal(req.Images)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	record := &model.MobileChatMessage{
		TenantId:         middleware.GetTenantId(c),
		UserId:           c.GetInt("id"),
		Role:             req.Role,
		Kind:             req.Kind,
		Model:            req.Model,
		ModelDisplayName: req.ModelDisplayName,
		Content:          req.Content,
		Images:           string(imageBytes),
		CreatedAtMs:      createdAt,
		ExpiresAtMs:      nowMs + model.MobileChatMessageTTLSeconds*1000,
	}
	if err := model.InsertMobileChatMessage(record); err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.DeleteExpiredMobileChatMessages(nowMs)
	common.ApiSuccess(c, mobileChatMessageToResponse(*record))
}

func normalizeMobileChatKind(kind string) string {
	kind = strings.TrimSpace(kind)
	if kind != "chat" && kind != "image" {
		return ""
	}
	return kind
}

func parseMobileChatInt(value string, fallback int) int {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func mobileChatMessageToResponse(record model.MobileChatMessage) mobileChatMessageResponse {
	var images []string
	if strings.TrimSpace(record.Images) != "" {
		_ = common.UnmarshalJsonStr(record.Images, &images)
	}
	return mobileChatMessageResponse{
		Id:               record.Id,
		Role:             record.Role,
		Kind:             record.Kind,
		Model:            record.Model,
		ModelDisplayName: record.ModelDisplayName,
		Content:          record.Content,
		Images:           images,
		CreatedAt:        record.CreatedAtMs,
		ExpiresAt:        record.ExpiresAtMs,
	}
}
