package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// TicketAdminList handles GET /api/ticket/admin (AdminAuth)
// List endpoints must respond flat: {items,total,page,page_size}.
func TicketAdminList(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	status := strings.TrimSpace(c.Query("status"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	userId := 0
	if userIdStr := strings.TrimSpace(c.Query("user_id")); userIdStr != "" {
		parsed, err := strconv.Atoi(userIdStr)
		if err != nil || parsed < 0 {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
		// Only pass user_id when > 0; treat 0 as "not set".
		if parsed > 0 {
			userId = parsed
		}
	}

	items, total, err := service.TicketAdminList(c.Request.Context(), middleware.GetTenantId(c), status, userId, keyword, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	respondTicketList(c, pageInfo, items, total)
}

// TicketAdminDetail handles GET /api/ticket/admin/:id (AdminAuth)
func TicketAdminDetail(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	ticket, replies, attachments, err := service.TicketAdminGetDetail(c.Request.Context(), middleware.GetTenantId(c), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"ticket":      ticket,
		"replies":     replies,
		"attachments": attachments,
	})
}

// TicketAdminReply handles POST /api/ticket/admin/:id/reply (AdminAuth)
func TicketAdminReply(c *gin.Context) {
	adminId := c.GetInt("id")

	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil || ticketID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.TicketReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Content) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	reply, err := service.TicketAdminReply(c.Request.Context(), middleware.GetTenantId(c), adminId, ticketID, req.Content, req.ObjectKeys)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, reply)
}

// TicketAdminUpdateStatus handles POST /api/ticket/admin/:id/status (AdminAuth)
func TicketAdminUpdateStatus(c *gin.Context) {
	adminId := c.GetInt("id")

	ticketID, err := strconv.Atoi(c.Param("id"))
	if err != nil || ticketID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.TicketUpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Status) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	ticket, err := service.TicketAdminUpdateStatus(c.Request.Context(), middleware.GetTenantId(c), adminId, ticketID, req.Status)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, ticket)
}

// TicketAdminPresignAttachment handles GET /api/ticket/admin/attachments/:att_id/presign (AdminAuth)
// Must return JSON {url, expires_at}.
func TicketAdminPresignAttachment(c *gin.Context) {
	attID, err := strconv.Atoi(c.Param("att_id"))
	if err != nil || attID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}


	disposition := strings.TrimSpace(c.Query("disposition"))
	if disposition == "" {
		disposition = "inline"
	}

	url, expiresAt, err := service.TicketPresignAttachmentForAdmin(c.Request.Context(), middleware.GetTenantId(c), attID, disposition)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, dto.TicketPresignAttachmentResponse{
		URL:             url,
		ExpiresAtUnixSec: expiresAt,
	})
}
