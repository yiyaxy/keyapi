package app

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

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

func ListMobileChatMessages(c *gin.Context) {
	nowMs := time.Now().UnixMilli()
	_ = model.DeleteExpiredMobileChatMessages(nowMs)

	kind := normalizeMobileChatKind(c.Query("kind"))
	records, err := model.ListMobileChatMessages(middleware.GetTenantId(c), c.GetInt("id"), kind, nowMs, 100)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]mobileChatMessageResponse, 0, len(records))
	for _, record := range records {
		items = append(items, mobileChatMessageToResponse(record))
	}
	common.ApiSuccess(c, gin.H{"items": items})
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
