package app

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	"github.com/gin-gonic/gin"
)

type imageDiagnosisResultRequest struct {
	OwnerKey       string `json:"owner_key"`
	ResultId       string `json:"result_id"`
	TaskId         string `json:"task_id"`
	UpstreamTaskId string `json:"upstream_task_id"`
	AppType        string `json:"app_type"`
	AppTitle       string `json:"app_title"`
	ImageUrl       string `json:"image_url"`
	PosterUrl      string `json:"poster_url"`
	Status         string `json:"status"`
	Progress       int    `json:"progress"`
	Message        string `json:"message"`
	Option         string `json:"option"`
	OptionLabel    string `json:"option_label"`
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	Settings       string `json:"settings"`
	CreatedAt      int64  `json:"created_at"`
}

func ListImageDiagnosisResults(c *gin.Context) {
	ownerKey := strings.TrimSpace(c.Query("ownerKey"))
	if ownerKey == "" {
		common.ApiErrorMsg(c, "ownerKey is required")
		return
	}

	nowMs := time.Now().UnixMilli()
	_ = model.DeleteExpiredImageDiagnosisResults(nowMs)
	records, err := model.ListImageDiagnosisResults(middleware.GetTenantId(c), ownerKey, nowMs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range records {
		syncImageDiagnosisRecordFromTask(&records[i])
	}
	common.ApiSuccess(c, gin.H{"items": records})
}

func GetImageDiagnosisResult(c *gin.Context) {
	ownerKey := strings.TrimSpace(c.Query("ownerKey"))
	resultId := strings.TrimSpace(c.Param("result_id"))
	if ownerKey == "" || resultId == "" {
		common.ApiErrorMsg(c, "ownerKey and result_id are required")
		return
	}

	record, err := model.GetImageDiagnosisResult(middleware.GetTenantId(c), ownerKey, resultId, time.Now().UnixMilli())
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "record not found"})
		return
	}
	syncImageDiagnosisRecordFromTask(record)
	common.ApiSuccess(c, record)
}

func SaveImageDiagnosisResult(c *gin.Context) {
	var req imageDiagnosisResultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}

	req.OwnerKey = strings.TrimSpace(req.OwnerKey)
	req.ResultId = strings.TrimSpace(req.ResultId)
	req.AppType = strings.TrimSpace(req.AppType)
	req.PosterUrl = strings.TrimSpace(req.PosterUrl)
	if req.OwnerKey == "" || req.ResultId == "" || req.AppType == "" {
		common.ApiErrorMsg(c, "owner_key, result_id and app_type are required")
		return
	}
	if req.Status == "" {
		req.Status = "pending"
	}
	if req.Progress < 0 {
		req.Progress = 0
	} else if req.Progress > 100 {
		req.Progress = 100
	}

	nowMs := time.Now().UnixMilli()
	createdAt := req.CreatedAt
	if createdAt <= 0 {
		createdAt = nowMs
	}

	record := &model.ImageDiagnosisResult{
		TenantId:       middleware.GetTenantId(c),
		OwnerKey:       req.OwnerKey,
		ResultId:       req.ResultId,
		TaskId:         req.TaskId,
		UpstreamTaskId: req.UpstreamTaskId,
		AppType:        req.AppType,
		AppTitle:       req.AppTitle,
		ImageUrl:       req.ImageUrl,
		PosterUrl:      req.PosterUrl,
		Status:         req.Status,
		Progress:       req.Progress,
		Message:        req.Message,
		Option:         req.Option,
		OptionLabel:    req.OptionLabel,
		Model:          req.Model,
		Prompt:         req.Prompt,
		Settings:       req.Settings,
		CreatedAtMs:    createdAt,
		ExpiresAtMs:    nowMs + model.ImageDiagnosisResultTTLSeconds*1000,
	}
	if err := model.UpsertImageDiagnosisResult(record); err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.DeleteExpiredImageDiagnosisResults(nowMs)
	common.ApiSuccess(c, record)
}

func syncImageDiagnosisRecordFromTask(record *model.ImageDiagnosisResult) {
	if record == nil || record.UpstreamTaskId == "" {
		return
	}
	if record.Status == "succeeded" || record.Status == "failed" {
		return
	}
	task, exists, err := model.GetByOnlyTaskId(record.UpstreamTaskId)
	if err != nil || !exists || task == nil {
		return
	}

	changed := false
	switch task.Status {
	case model.TaskStatusNotStart, model.TaskStatusSubmitted, model.TaskStatusQueued:
		if record.Status != "pending" {
			record.Status = "pending"
			changed = true
		}
		if record.Progress < 35 {
			record.Progress = 35
			changed = true
		}
		if record.Message == "" {
			record.Message = "任务排队中，等待上游开始生成"
			changed = true
		}
	case model.TaskStatusInProgress:
		if record.Status != "running" {
			record.Status = "running"
			changed = true
		}
		if progress := parseTaskProgress(task.Progress, 68); progress > record.Progress {
			record.Progress = progress
			changed = true
		}
		record.Message = "高清海报生成中，请耐心等待"
		changed = true
	case model.TaskStatusSuccess:
		record.Status = "succeeded"
		record.Progress = 100
		record.Message = "报告海报已生成"
		if record.PosterUrl == "" {
			if url := firstImageResultURL(task); url != "" {
				record.PosterUrl = url
			}
		}
		changed = true
	case model.TaskStatusFailure:
		record.Status = "failed"
		record.Progress = 100
		record.Message = task.FailReason
		if record.Message == "" {
			record.Message = "报告海报生成失败"
		}
		changed = true
	}
	if changed {
		_ = model.UpsertImageDiagnosisResult(record)
	}
}

func parseTaskProgress(progress string, fallback int) int {
	progress = strings.TrimSuffix(strings.TrimSpace(progress), "%")
	value, err := strconv.Atoi(progress)
	if err != nil {
		return fallback
	}
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func firstImageResultURL(task *model.Task) string {
	if task == nil || len(task.PrivateData.ImageData) == 0 {
		return ""
	}
	var data []struct {
		Url     string `json:"url"`
		B64JSON string `json:"b64_json"`
	}
	if err := common.Unmarshal(task.PrivateData.ImageData, &data); err != nil || len(data) == 0 {
		return ""
	}
	if data[0].Url != "" {
		if objectKey, ok := ticket_storage.ObjectKeyFromURL(data[0].Url); ok {
			client, err := ticket_storage.GetClient()
			if err != nil {
				return ""
			}
			url, _, err := client.PresignGet(objectKey, 24*time.Hour)
			if err != nil {
				return ""
			}
			return url
		}
		return data[0].Url
	}
	if data[0].B64JSON != "" {
		return "data:image/png;base64," + data[0].B64JSON
	}
	return ""
}
