package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type TicketStorageSecretUpsertRequest struct {
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
}

const (
	ticketStorageAccessKeyOptionKey = "ticket_storage.access_key"
	ticketStorageSecretKeyOptionKey = "ticket_storage.secret_key"
)

// UpsertTicketStorageSecret handles PUT /api/ticket_storage/secret (AdminAuth)
// Body: {access_key, secret_key}
//
// This endpoint is write-only: it never returns stored secrets.
func UpsertTicketStorageSecret(c *gin.Context) {
	var req TicketStorageSecretUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.AccessKey) == "" || strings.TrimSpace(req.SecretKey) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	if err := model.UpdateOption(ticketStorageAccessKeyOptionKey, strings.TrimSpace(req.AccessKey)); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(ticketStorageSecretKeyOptionKey, strings.TrimSpace(req.SecretKey)); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{})
}
