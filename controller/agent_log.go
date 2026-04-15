package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAgentLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	agentName := strings.TrimSpace(c.Query("agent_name"))
	category := strings.TrimSpace(c.Query("category"))
	status := strings.TrimSpace(c.Query("status"))
	keyword := strings.TrimSpace(c.Query("keyword"))

	logs, total, err := model.GetAgentLogs(page, pageSize, agentName, category, status, keyword)
	if err != nil {
		common.ApiErrorMsg(c, "获取日志失败")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    logs,
		"total":   total,
		"page":    page,
	})
}

type CreateAgentLogRequest struct {
	AgentName   string `json:"agent_name" binding:"required"`
	Category    string `json:"category" binding:"required"`
	Action      string `json:"action" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Detail      string `json:"detail"`
}

func CreateAgentLog(c *gin.Context) {
	adminId := c.GetInt("id")

	var req CreateAgentLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = model.AgentLogStatusSuccess
	}

	log := &model.AgentLog{
		AdminId:     adminId,
		AgentName:   strings.TrimSpace(req.AgentName),
		Category:    strings.TrimSpace(req.Category),
		Action:      strings.TrimSpace(req.Action),
		Description: strings.TrimSpace(req.Description),
		Status:      status,
		Detail:      strings.TrimSpace(req.Detail),
	}

	if err := model.CreateAgentLog(log); err != nil {
		common.ApiErrorMsg(c, "创建日志失败")
		return
	}

	common.ApiSuccess(c, log)
}

type UpdateAgentLogRequest struct {
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func UpdateAgentLog(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req UpdateAgentLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	updates := map[string]interface{}{}
	if s := strings.TrimSpace(req.Status); s != "" {
		updates["status"] = s
	}
	if d := strings.TrimSpace(req.Detail); d != "" {
		updates["detail"] = d
	}

	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}

	if err := model.UpdateAgentLog(id, updates); err != nil {
		common.ApiErrorMsg(c, "更新失败")
		return
	}

	common.ApiSuccess(c, nil)
}

func DeleteAgentLog(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	if err := model.DeleteAgentLog(id); err != nil {
		common.ApiErrorMsg(c, "删除失败")
		return
	}

	common.ApiSuccess(c, nil)
}
