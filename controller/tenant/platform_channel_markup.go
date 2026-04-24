package tenant

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type upsertMarkupReq struct {
	ChannelId   int     `json:"channel_id" binding:"required"`
	MarkupRatio float64 `json:"markup_ratio" binding:"required"`
	Enabled     *bool   `json:"enabled"`
}

func UpsertPlatformChannelMarkup(c *gin.Context) {
	tenantID := middleware.GetTenantId(c)
	if tenantID <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"message": "tenant context missing"})
		return
	}

	var req upsertMarkupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if req.MarkupRatio <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "markup_ratio must be > 0"})
		return
	}

	ch, err := model.CacheGetChannel(req.ChannelId)
	if err != nil || ch == nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "channel not found"})
		return
	}
	if ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"message": "only platform-scoped channels accept tenant markup overrides"})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	row := &model.TenantPlatformChannelMarkup{
		TenantId:    tenantID,
		ChannelId:   req.ChannelId,
		MarkupRatio: req.MarkupRatio,
		Enabled:     enabled,
	}
	if err := model.UpsertTenantPlatformChannelMarkup(row); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": row})
}

func DeletePlatformChannelMarkup(c *gin.Context) {
	tenantID := middleware.GetTenantId(c)
	if tenantID <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"message": "tenant context missing"})
		return
	}
	channelID, err := strconv.Atoi(c.Param("channel_id"))
	if err != nil || channelID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel_id"})
		return
	}
	if err := model.DeleteTenantPlatformChannelMarkup(tenantID, channelID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}
