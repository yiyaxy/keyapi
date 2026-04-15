package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAgentReports(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	reportType := strings.TrimSpace(c.Query("report_type"))
	keyword := strings.TrimSpace(c.Query("keyword"))

	reports, total, err := model.GetAgentReports(page, pageSize, reportType, keyword)
	if err != nil {
		common.ApiErrorMsg(c, "获取报告失败")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    reports,
		"total":   total,
		"page":    page,
	})
}

func GetAgentReportDetail(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	report, err := model.GetAgentReportById(id)
	if err != nil {
		common.ApiErrorMsg(c, "报告不存在")
		return
	}

	common.ApiSuccess(c, report)
}

type CreateAgentReportRequest struct {
	Title       string `json:"title" binding:"required"`
	ReportType  string `json:"report_type" binding:"required"`
	Summary     string `json:"summary"`
	HtmlContent string `json:"html_content"`
	AgentName   string `json:"agent_name" binding:"required"`
	Status      string `json:"status"`
}

func CreateAgentReport(c *gin.Context) {
	var req CreateAgentReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = model.ReportStatusCompleted
	}

	report := &model.AgentReport{
		Title:       strings.TrimSpace(req.Title),
		ReportType:  strings.TrimSpace(req.ReportType),
		Summary:     strings.TrimSpace(req.Summary),
		HtmlContent: req.HtmlContent,
		AgentName:   strings.TrimSpace(req.AgentName),
		Status:      status,
	}

	if err := model.CreateAgentReport(report); err != nil {
		common.ApiErrorMsg(c, "创建报告失败")
		return
	}

	common.ApiSuccess(c, report)
}

type UpdateAgentReportRequest struct {
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	HtmlContent string `json:"html_content"`
	Status      string `json:"status"`
}

func UpdateAgentReport(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req UpdateAgentReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	updates := map[string]interface{}{}
	if s := strings.TrimSpace(req.Title); s != "" {
		updates["title"] = s
	}
	if s := strings.TrimSpace(req.Summary); s != "" {
		updates["summary"] = s
	}
	if req.HtmlContent != "" {
		updates["html_content"] = req.HtmlContent
	}
	if s := strings.TrimSpace(req.Status); s != "" {
		updates["status"] = s
	}

	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}

	if err := model.UpdateAgentReport(id, updates); err != nil {
		common.ApiErrorMsg(c, "更新失败")
		return
	}

	common.ApiSuccess(c, nil)
}

func DeleteAgentReport(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	if err := model.DeleteAgentReport(id); err != nil {
		common.ApiErrorMsg(c, "删除失败")
		return
	}

	common.ApiSuccess(c, nil)
}
