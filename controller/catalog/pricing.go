package catalog

import (
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetPricing(c *gin.Context) {
	pricing := model.GetPricing()
	userId, exists := c.Get("id")
	tenantId := middleware.GetTenantId(c)
	usableGroup := map[string]string{}
	groupRatio := service.GetTenantGroupRatioMap(tenantId)
	groupGroupRatio := service.GetTenantGroupGroupRatioMap(tenantId)
	var group string
	if exists {
		user, err := model.GetUserCacheWithContext(c, userId.(int))
		if err == nil {
			group = user.Group
			for g := range groupRatio {
				ratio, _ := service.GetTenantUserGroupRatioFromMaps(groupRatio, groupGroupRatio, group, g)
				groupRatio[g] = ratio
			}
		}
	}

	usableGroup = service.GetTenantUserUsableGroups(tenantId, group)
	// check groupRatio contains usableGroup
	for groupName := range groupRatio {
		if _, ok := usableGroup[groupName]; !ok {
			delete(groupRatio, groupName)
		}
	}

	c.JSON(200, gin.H{
		"success":            true,
		"data":               pricing,
		"vendors":            model.GetVendors(),
		"group_ratio":        groupRatio,
		"usable_group":       usableGroup,
		"supported_endpoint": model.GetSupportedEndpointMap(),
		"auto_groups":        service.GetTenantUserAutoGroup(tenantId, group),
		"pricing_version":    "a42d372ccf0b5dd13ecf71203521f9d2",
	})
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	err := model.UpdateOption("ModelRatio", defaultStr)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	err = ratio_setting.UpdateModelRatioByJSONString(defaultStr)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "重置模型倍率成功",
	})
}
