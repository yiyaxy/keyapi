package user

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAllUserRebateSettings(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	settings, total, err := model.GetAllUserRebateSettings(pageInfo, keyword)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(settings)
	common.ApiSuccess(c, pageInfo)
}

func CreateUserRebateSetting(c *gin.Context) {
	var setting model.UserRebateSetting
	if err := c.ShouldBindJSON(&setting); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if setting.InviterId <= 0 {
		common.ApiErrorMsg(c, "inviter_id is required")
		return
	}
	setting.Id = 0
	if err := model.CreateUserRebateSetting(&setting); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, setting)
}

func UpdateUserRebateSetting(c *gin.Context) {
	var setting model.UserRebateSetting
	if err := c.ShouldBindJSON(&setting); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if setting.Id == 0 {
		common.ApiErrorMsg(c, "setting id is required")
		return
	}
	if err := model.UpdateUserRebateSetting(&setting); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, setting)
}

func GetUserRebateSetting(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	setting := model.GetEffectiveRebateSetting(id, middleware.GetTenantId(c))
	common.ApiSuccess(c, setting)
}

func DeleteUserRebateSetting(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	if err := model.DeleteUserRebateSetting(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
