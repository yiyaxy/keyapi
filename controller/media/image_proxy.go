package media

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func imageProxyError(c *gin.Context, status int, errType, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    errType,
		},
	})
}

func ImageProxy(c *gin.Context) {
	taskID := c.Param("task_id")
	indexStr := c.Param("index")
	if taskID == "" {
		imageProxyError(c, http.StatusBadRequest, "invalid_request_error", "task_id is required")
		return
	}
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		imageProxyError(c, http.StatusNotFound, "invalid_request_error", "Image not found")
		return
	}

	task, exists, err := model.GetByTaskId(c.GetInt("id"), taskID)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to query image task %s: %s", taskID, err.Error()))
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Failed to query task")
		return
	}
	if !exists || task == nil {
		imageProxyError(c, http.StatusNotFound, "invalid_request_error", "Task not found")
		return
	}
	if task.Status != model.TaskStatusSuccess {
		imageProxyError(c, http.StatusBadRequest, "invalid_request_error", fmt.Sprintf("Task is not completed yet, current status: %s", task.Status))
		return
	}

	var imageData []dto.ImageData
	if len(task.PrivateData.ImageData) == 0 {
		imageProxyError(c, http.StatusNotFound, "invalid_request_error", "Image not found")
		return
	}
	if err := common.Unmarshal(task.PrivateData.ImageData, &imageData); err != nil {
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Invalid image data")
		return
	}
	if index >= len(imageData) {
		imageProxyError(c, http.StatusNotFound, "invalid_request_error", "Image not found")
		return
	}
	upstreamURL := strings.TrimSpace(imageData[index].Url)
	if upstreamURL == "" {
		imageProxyError(c, http.StatusBadRequest, "invalid_request_error", "inline base64 not proxyable, fetch full task")
		return
	}

	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to get channel for image task %s: %s", taskID, err.Error()))
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Failed to retrieve channel information")
		return
	}

	fetchSetting := system_setting.GetFetchSetting()
	if err := common.ValidateURLWithFetchSetting(upstreamURL, fetchSetting.EnableSSRFProtection, fetchSetting.AllowPrivateIp, fetchSetting.DomainFilterMode, fetchSetting.IpFilterMode, fetchSetting.DomainList, fetchSetting.IpList, fetchSetting.AllowedPorts, fetchSetting.ApplyIPFilterForDomain); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Image URL blocked for task %s: %v", taskID, err))
		imageProxyError(c, http.StatusForbidden, "server_error", fmt.Sprintf("request blocked: %v", err))
		return
	}

	parsedURL, err := url.Parse(upstreamURL)
	if err != nil {
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy request")
		return
	}
	client, err := service.GetHttpClientWithProxy(channel.GetSetting().Proxy)
	if err != nil {
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy client")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		imageProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy request")
		return
	}
	req.URL = parsedURL

	resp, err := client.Do(req)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to fetch image from %s: %s", upstreamURL, err.Error()))
		imageProxyError(c, http.StatusServiceUnavailable, "server_error", "Failed to fetch image content")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		imageProxyError(c, resp.StatusCode, "server_error", fmt.Sprintf("Upstream service returned status %d", resp.StatusCode))
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" {
		c.Writer.Header().Set("Content-Type", contentType)
	}
	c.Writer.Header().Set("Cache-Control", "public, max-age=86400")
	c.Writer.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to stream image content: %s", err.Error()))
	}
}
