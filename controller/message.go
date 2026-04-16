package controller

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type createMessageRequest struct {
	Title        string `json:"title"`
	Content      string `json:"content"`
	Type         int    `json:"type"`
	TargetUserId int    `json:"target_user_id"`
}

type editMessageRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func AdminCreateMessage(c *gin.Context) {
	var req createMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if req.Title == "" || req.Content == "" {
		common.ApiErrorMsg(c, "title and content cannot be empty")
		return
	}
	if req.Type != model.MessageTypeDirected && req.Type != model.MessageTypeBroadcast {
		common.ApiErrorMsg(c, "invalid message type")
		return
	}
	if req.Type == model.MessageTypeDirected && req.TargetUserId <= 0 {
		common.ApiErrorMsg(c, "directed message must specify target user")
		return
	}

	senderId := c.GetInt("id")
	msg := &model.Message{
		TenantId:     middleware.GetTenantId(c),
		Title:        req.Title,
		Content:      req.Content,
		Type:         req.Type,
		TargetUserId: req.TargetUserId,
		SenderId:     senderId,
	}
	if err := model.CreateMessage(msg); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, msg)
}

func AdminListMessages(c *gin.Context) {
	page := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	msgType, _ := strconv.Atoi(c.Query("type"))

	messages, total, err := model.GetAllMessages(middleware.GetTenantId(c), page, keyword, msgType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(messages)
	common.ApiSuccess(c, page)
}

func AdminGetMessage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	msg, err := model.GetMessageById(middleware.GetTenantId(c), id)
	if err != nil {
		common.ApiErrorMsg(c, "message not found")
		return
	}
	common.ApiSuccess(c, msg)
}

func AdminEditMessage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	var req editMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	updates := map[string]interface{}{}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Content != "" {
		updates["content"] = req.Content
	}
	if len(updates) == 0 {
		common.ApiErrorMsg(c, "no fields to update")
		return
	}
	if err := model.UpdateMessage(middleware.GetTenantId(c), id, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.DeleteTranslationsByMessageId(id)
	_ = model.DeleteContentTranslationsByTypeAndId("message", strconv.Itoa(id))
	common.ApiSuccess(c, nil)
}

func AdminRecallMessage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	if err := model.RecallMessage(middleware.GetTenantId(c), id); err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.DeleteTranslationsByMessageId(id)
	_ = model.DeleteContentTranslationsByTypeAndId("message", strconv.Itoa(id))
	common.ApiSuccess(c, nil)
}

func AdminGetMessageReadStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	page := common.GetPageQuery(c)
	statuses, total, err := model.GetMessageReadStatuses(middleware.GetTenantId(c), id, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(statuses)
	common.ApiSuccess(c, page)
}

// User inbox handlers

func GetUserInbox(c *gin.Context) {
	userId := c.GetInt("id")
	page := common.GetPageQuery(c)
	messages, total, err := model.GetUserInbox(middleware.GetTenantId(c), userId, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	lang := c.Query("lang")
	if lang != "" && lang != "zh" {
		for i := range messages {
			translated, _ := service.TranslateContent("message", fmt.Sprintf("%d", messages[i].Id), map[string]string{"title": messages[i].Title}, lang)
			if t, ok := translated["title"]; ok {
				messages[i].Title = t
			}
		}
	}
	page.SetTotal(int(total))
	page.SetItems(messages)
	common.ApiSuccess(c, page)
}

func GetUserInboxMessage(c *gin.Context) {
	userId := c.GetInt("id")
	msgId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	msg, err := model.GetUserInboxMessage(middleware.GetTenantId(c), userId, msgId)
	if err != nil {
		common.ApiErrorMsg(c, "message not found")
		return
	}
	// Auto mark as read with IP and User-Agent
	_ = model.MarkMessageAsRead(middleware.GetTenantId(c), userId, msgId, c.ClientIP(), c.GetHeader("User-Agent"))
	msg.IsRead = true

	lang := c.Query("lang")
	translated := false
	if lang != "" && common.TranslationChannelId > 0 {
		t, _ := service.TranslateMessage(msgId, msg.Title, msg.Content, lang)
		if t != nil {
			msg.Title = t.Title
			msg.Content = t.Content
			translated = true
		}
	}

	common.ApiSuccess(c, gin.H{
		"id":             msg.Id,
		"title":          msg.Title,
		"content":        msg.Content,
		"type":           msg.Type,
		"target_user_id": msg.TargetUserId,
		"sender_id":      msg.SenderId,
		"status":         msg.Status,
		"created_at":     msg.CreatedAt,
		"is_read":        msg.IsRead,
		"read_at":        msg.ReadAt,
		"translated":     translated,
	})
}

func MarkMessageRead(c *gin.Context) {
	userId := c.GetInt("id")
	msgId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid message ID")
		return
	}
	if err := model.MarkMessageAsRead(middleware.GetTenantId(c), userId, msgId, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetUnreadMessageCount(c *gin.Context) {
	userId := c.GetInt("id")
	count, err := model.GetUnreadCount(middleware.GetTenantId(c), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}
