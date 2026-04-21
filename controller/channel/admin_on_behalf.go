package channel

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func parseTenantIdParam(c *gin.Context) (int, bool) {
	v, err := strconv.Atoi(c.Param("tenantId"))
	if err != nil || v <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid tenantId"})
		return 0, false
	}
	return v, true
}

func AdminOnBehalfToggleChannel(c *gin.Context) {
	tenantId, ok := parseTenantIdParam(c)
	if !ok {
		return
	}
	channelId, err := strconv.Atoi(c.Param("channelId"))
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
	ch, err := model.GetChannelById(channelId, false)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "only platform channels can be toggled"})
		return
	}
	if err := model.SetTenantChannelDisabled(tenantId, channelId, body.Disabled); err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateTenantRoutingCache(tenantId)
	service.PurgeTenantAffinityCache(tenantId)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func AdminOnBehalfFixChannelsAbilities(c *gin.Context) {
	tenantId, ok := parseTenantIdParam(c)
	if !ok {
		return
	}
	success, fails, err := model.FixTenantAbilities(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"success": success, "fails": fails}})
}
