package catalog

import (
	"net/http"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for _, groupName := range service.GetTenantGroupNames(middleware.GetTenantId(c)) {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	tenantId := middleware.GetTenantId(c)
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetTenantUserUsableGroups(tenantId, userGroup)
	groupRatioMap := service.GetTenantGroupRatioMap(tenantId)
	groupGroupRatioMap := service.GetTenantGroupGroupRatioMap(tenantId)
	for groupName := range groupRatioMap {
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			ratio, _ := service.GetTenantUserGroupRatioFromMaps(groupRatioMap, groupGroupRatioMap, userGroup, groupName)
			usableGroups[groupName] = map[string]interface{}{
				"ratio": ratio,
				"desc":  desc,
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]interface{}{
			"ratio": "自动",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}

// GetChannelGroups returns only groups that have at least one enabled channel,
// filtered by the user's usable groups. This excludes pure user-tier groups
// (VIP/SVIP/VVIP) that have no channels attached.
func GetChannelGroups(c *gin.Context) {
	userId := c.GetInt("id")
	tenantId := middleware.GetTenantId(c)
	userGroup, _ := model.GetUserGroup(userId, false)
	usableGroups := service.GetTenantUserUsableGroups(tenantId, userGroup)
	channelGroups := model.GetChannelGroupsCopy(tenantId)
	groupRatioMap := service.GetTenantGroupRatioMap(tenantId)
	groupGroupRatioMap := service.GetTenantGroupGroupRatioMap(tenantId)

	result := make(map[string]map[string]interface{})
	for groupName := range channelGroups {
		if desc, ok := usableGroups[groupName]; ok {
			ratio, _ := service.GetTenantUserGroupRatioFromMaps(groupRatioMap, groupGroupRatioMap, userGroup, groupName)
			result[groupName] = map[string]interface{}{
				"ratio": ratio,
				"desc":  desc,
			}
		}
	}
	// "auto" is a special routing mode, not a real channel group, but should be available
	if _, ok := usableGroups["auto"]; ok {
		result["auto"] = map[string]interface{}{
			"ratio": "自动",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}
