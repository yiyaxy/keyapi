package user

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAllUserLevels(c *gin.Context) {
	levels, err := model.GetAllUserLevels(middleware.GetTenantId(c), true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, levels)
}

func CreateUserLevel(c *gin.Context) {
	var level model.UserLevel
	if err := c.ShouldBindJSON(&level); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	level.Id = 0
	level.TenantId = middleware.GetTenantId(c)
	if err := model.CreateUserLevel(&level); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, level)
}

func UpdateUserLevel(c *gin.Context) {
	var level model.UserLevel
	if err := c.ShouldBindJSON(&level); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if level.Id <= 0 {
		common.ApiErrorMsg(c, "level id is required")
		return
	}
	level.TenantId = middleware.GetTenantId(c)
	if err := model.UpdateUserLevel(&level); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, level)
}

func DeleteUserLevel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	if err := model.DeleteUserLevel(middleware.GetTenantId(c), id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
