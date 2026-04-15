package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func respondTicketList(c *gin.Context, pageInfo *common.PageInfo, items any, total int64) {
	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// TicketPresignUpload handles POST /api/ticket/uploads/presign (UserAuth)
func TicketPresignUpload(c *gin.Context) {
	userId := c.GetInt("id")

	var req dto.TicketPresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Filename) == "" || strings.TrimSpace(req.ContentType) == "" || req.SizeBytes <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	objectKey, uploadURL, requiredHeaders, expiresAt, err := service.TicketPresignUpload(c.Request.Context(), userId, req.Filename, req.ContentType, req.SizeBytes)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, dto.TicketPresignUploadResponse{
		ObjectKey:        objectKey,
		UploadURL:        uploadURL,
		RequiredHeaders:  requiredHeaders,
		ExpiresAtUnixSec: expiresAt,
	})
}

// TicketCreate handles POST /api/ticket (UserAuth)
func TicketCreate(c *gin.Context) {
	userId := c.GetInt("id")

	var req dto.TicketCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Subject) == "" || strings.TrimSpace(req.Content) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	ticket, reply, err := service.CreateTicket(c.Request.Context(), nil, userId, req.Subject, req.Content, req.ObjectKeys)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"ticket": ticket,
		"reply":  reply,
	})
}

// TicketList handles GET /api/ticket (UserAuth)
func TicketList(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)

	items, total, err := service.TicketListUser(c.Request.Context(), userId, "", "", pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	respondTicketList(c, pageInfo, items, total)
}

// TicketDetail handles GET /api/ticket/:id (UserAuth)
func TicketDetail(c *gin.Context) {
	userId := c.GetInt("id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	ticket, replies, attachments, err := service.TicketGetUserDetail(c.Request.Context(), userId, id)
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

// TicketReply handles POST /api/ticket/:id/reply (UserAuth)
func TicketReply(c *gin.Context) {
	userId := c.GetInt("id")

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

	reply, err := service.TicketReplyUser(c.Request.Context(), userId, ticketID, req.Content, req.ObjectKeys)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, reply)
}

// TicketPresignAttachment handles GET /api/ticket/attachments/:att_id/presign (UserAuth)
// Must return JSON {url, expires_at}.
func TicketPresignAttachment(c *gin.Context) {
	userId := c.GetInt("id")

	attID, err := strconv.Atoi(c.Param("att_id"))
	if err != nil || attID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	disposition := strings.TrimSpace(c.Query("disposition"))
	if disposition == "" {
		disposition = "inline"
	}

	url, expiresAt, err := service.TicketPresignAttachmentForUser(c.Request.Context(), userId, attID, disposition)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, dto.TicketPresignAttachmentResponse{
		URL:             url,
		ExpiresAtUnixSec: expiresAt,
	})
}
