package channel

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/ollama"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type tenantChannelOut struct {
	*model.Channel
	TenantDisabled      bool `json:"tenant_disabled,omitempty"`
	TenantChannelLocked bool `json:"tenant_channel_locked,omitempty"`
}

func annotateTenantChannels(
	channels []*model.Channel,
	disabled map[int]struct{},
	locked map[int]struct{},
) []tenantChannelOut {
	out := make([]tenantChannelOut, 0, len(channels))
	for _, ch := range channels {
		model.SanitizeForTenantView(ch)
		clearChannelInfo(ch)
		item := tenantChannelOut{Channel: ch}
		if ch.Scope == model.ChannelScopePlatform {
			_, item.TenantDisabled = disabled[ch.Id]
			_, item.TenantChannelLocked = locked[ch.Id]
		}
		out = append(out, item)
	}
	return out
}

func TenantListChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	pageInfo := common.GetPageQuery(c)
	idSort, _ := strconv.ParseBool(c.Query("id_sort"))
	enableTagMode, _ := strconv.ParseBool(c.Query("tag_mode"))
	statusFilter := parseStatusFilter(c.Query("status"))
	typeFilter := -1
	if typeStr := c.Query("type"); typeStr != "" {
		if t, err := strconv.Atoi(typeStr); err == nil {
			typeFilter = t
		}
	}

	order := "priority desc"
	if idSort {
		order = "id desc"
	}

	var channelData []*model.Channel
	var total int64
	if enableTagMode {
		tags, err := model.GetPaginatedTagsForTenant(tenantId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, tag := range tags {
			if tag == nil || *tag == "" {
				continue
			}
			rows, err := model.GetChannelsByTagForTenant(*tag, tenantId, idSort, false)
			if err != nil {
				continue
			}
			for _, ch := range rows {
				if statusFilter == common.ChannelStatusEnabled && ch.Status != common.ChannelStatusEnabled {
					continue
				}
				if statusFilter == 0 && ch.Status == common.ChannelStatusEnabled {
					continue
				}
				if typeFilter >= 0 && ch.Type != typeFilter {
					continue
				}
				channelData = append(channelData, ch)
			}
		}
		total = int64(len(channelData))
	} else {
		baseQuery := model.DB.Model(&model.Channel{}).Where("scope = ? OR tenant_id = ?", model.ChannelScopePlatform, tenantId)
		if typeFilter >= 0 {
			baseQuery = baseQuery.Where("type = ?", typeFilter)
		}
		if statusFilter == common.ChannelStatusEnabled {
			baseQuery = baseQuery.Where("status = ?", common.ChannelStatusEnabled)
		} else if statusFilter == 0 {
			baseQuery = baseQuery.Where("status != ?", common.ChannelStatusEnabled)
		}
		if err := baseQuery.Count(&total).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if err := baseQuery.Order(order).Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Omit("key").Find(&channelData).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}

	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	locked, _ := model.GetTenantLockedPlatformChannels(tenantId)
	common.ApiSuccess(c, gin.H{
		"items":     annotateTenantChannels(channelData, disabled, locked),
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

func TenantSearchChannels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	keyword := c.Query("keyword")
	group := c.Query("group")
	modelKw := c.Query("model")
	statusFilter := parseStatusFilter(c.Query("status"))
	idSort, _ := strconv.ParseBool(c.Query("id_sort"))
	enableTagMode, _ := strconv.ParseBool(c.Query("tag_mode"))

	channelData := make([]*model.Channel, 0)
	if enableTagMode {
		tags, err := model.SearchTagsForTenant(tenantId, keyword, group, modelKw, idSort)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, tag := range tags {
			if tag == nil || *tag == "" {
				continue
			}
			rows, err := model.GetChannelsByTagForTenant(*tag, tenantId, idSort, false)
			if err == nil {
				channelData = append(channelData, rows...)
			}
		}
	} else {
		rows, err := model.SearchChannelsForTenant(tenantId, keyword, group, modelKw, idSort)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		channelData = rows
	}

	if statusFilter == common.ChannelStatusEnabled || statusFilter == 0 {
		filtered := make([]*model.Channel, 0, len(channelData))
		for _, ch := range channelData {
			if statusFilter == common.ChannelStatusEnabled && ch.Status != common.ChannelStatusEnabled {
				continue
			}
			if statusFilter == 0 && ch.Status == common.ChannelStatusEnabled {
				continue
			}
			filtered = append(filtered, ch)
		}
		channelData = filtered
	}

	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	locked, _ := model.GetTenantLockedPlatformChannels(tenantId)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": annotateTenantChannels(channelData, disabled, locked),
			"total": len(channelData),
		},
	})
}

func TenantGetChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetVisibleChannelForTenant(id, tenantId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	disabled, _ := model.GetTenantDisabledPlatformChannels(tenantId)
	locked, _ := model.GetTenantLockedPlatformChannels(tenantId)
	out := annotateTenantChannels([]*model.Channel{ch}, disabled, locked)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": out[0]})
}

func TenantGetChannelKey(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetOwnedChannelForTenant(channelId, tenantId, true)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "not accessible"})
		return
	}
	model.RecordLogCtx(c, userId, model.LogTypeSystem, fmt.Sprintf("查看渠道密钥 (租户 channelId=%d)", channelId))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "获取成功", "data": gin.H{"key": ch.Key}})
}

func TenantAddChannel(c *gin.Context) {
	AddChannel(c)
}

func TenantUpdateChannel(c *gin.Context) {
	UpdateChannel(c)
}

func TenantDeleteChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetOwnedChannelForTenant(id, tenantId, false)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "not accessible"})
		return
	}
	if err := ch.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	service.ResetProxyClientCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func TenantToggleChannel(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var body struct {
		Disabled bool `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetVisibleChannelForTenant(channelId, tenantId, false)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "channel not found"})
		return
	}
	if ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "can only toggle platform channels"})
		return
	}
	if err := model.SetTenantChannelDisabledAsTenant(tenantId, channelId, body.Disabled); err != nil {
		if errors.Is(err, model.ErrTenantChannelLocked) {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "此渠道已被平台管理员禁用，无法由租户启用",
			})
			return
		}
		common.ApiError(c, err)
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	service.PurgeTenantAffinityCache(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func TenantGetPlatformChannelMode(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	mode, err := model.GetTenantPlatformChannelMode(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"mode": mode}})
}

func TenantSetPlatformChannelMode(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	var body struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetTenantPlatformChannelMode(tenantId, body.Mode); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	service.PurgeTenantAffinityCache(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func TenantDeleteChannelBatch(c *gin.Context) {
	DeleteChannelBatch(c)
}

func TenantBatchSetChannelTag(c *gin.Context) {
	channelBatch := ChannelBatch{}
	if err := c.ShouldBindJSON(&channelBatch); err != nil || len(channelBatch.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.BatchSetChannelTagForTenant(channelBatch.Ids, channelBatch.Tag, middleware.GetTenantId(c)); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": len(channelBatch.Ids)})
}

func TenantDeleteDisabledChannel(c *gin.Context) { DeleteDisabledChannel(c) }
func TenantDisableTagChannels(c *gin.Context)  { DisableTagChannels(c) }
func TenantEnableTagChannels(c *gin.Context)   { EnableTagChannels(c) }
func TenantEditTagChannels(c *gin.Context)     { EditTagChannels(c) }

func TenantGetTagModels(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	tag := c.Query("tag")
	if tag == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "tag不能为空"})
		return
	}
	channels, err := model.GetChannelsByTagForTenant(tag, tenantId, false, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var longestModels string
	maxLength := 0
	for _, ch := range channels {
		if ch.Models == "" {
			continue
		}
		currentModels := strings.Split(ch.Models, ",")
		if len(currentModels) > maxLength {
			maxLength = len(currentModels)
			longestModels = ch.Models
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": longestModels})
}

func TenantFixChannelsAbilities(c *gin.Context) {
	success, fails, err := model.FixTenantAbilities(middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"success": success, "fails": fails}})
}

func tenantOwnedOllamaChannel(c *gin.Context, channelId int) (*model.Channel, bool) {
	tenantId := middleware.GetTenantId(c)
	ch, err := model.GetOwnedChannelForTenant(channelId, tenantId, true)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "channel not accessible"})
		return nil, false
	}
	if ch.Type != constant.ChannelTypeOllama {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "only Ollama channels"})
		return nil, false
	}
	return ch, true
}

func TenantOllamaPullModel(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOwnedOllamaChannel(c, req.ChannelID); !ok {
		return
	}
	ch, _ := tenantOwnedOllamaChannel(c, req.ChannelID)
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	key := strings.Split(ch.Key, "\n")[0]
	if err := ollama.PullOllamaModel(baseURL, key, req.ModelName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": fmt.Sprintf("Failed to pull model: %s", err.Error())})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Model %s pulled successfully", req.ModelName)})
}

func TenantOllamaPullModelStream(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOwnedOllamaChannel(c, req.ChannelID); !ok {
		return
	}
	ch, _ := tenantOwnedOllamaChannel(c, req.ChannelID)
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")
	key := strings.Split(ch.Key, "\n")[0]
	progressCallback := func(progress ollama.OllamaPullResponse) {
		data, _ := json.Marshal(progress)
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
		c.Writer.Flush()
	}
	err := ollama.PullOllamaModelStream(baseURL, key, req.ModelName, progressCallback)
	if err != nil {
		errorData, _ := json.Marshal(gin.H{"error": err.Error()})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(errorData))
	} else {
		successData, _ := json.Marshal(gin.H{"message": fmt.Sprintf("Model %s pulled successfully", req.ModelName)})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(successData))
	}
	fmt.Fprintf(c.Writer, "data: [DONE]\n\n")
	c.Writer.Flush()
}

func TenantOllamaDeleteModel(c *gin.Context) {
	var req struct {
		ChannelID int    `json:"channel_id"`
		ModelName string `json:"model_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOwnedOllamaChannel(c, req.ChannelID); !ok {
		return
	}
	ch, _ := tenantOwnedOllamaChannel(c, req.ChannelID)
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	key := strings.Split(ch.Key, "\n")[0]
	if err := ollama.DeleteOllamaModel(baseURL, key, req.ModelName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": fmt.Sprintf("Failed to delete model: %s", err.Error())})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Model %s deleted successfully", req.ModelName)})
}

func TenantOllamaVersion(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := tenantOwnedOllamaChannel(c, id); !ok {
		return
	}
	OllamaVersion(c)
}
