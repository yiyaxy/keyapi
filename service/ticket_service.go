package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	"github.com/QuantumNous/new-api/types"

	"gorm.io/gorm"
)

type TicketReplyRole string

const (
	TicketReplyRoleUser  TicketReplyRole = "user"
	TicketReplyRoleAdmin TicketReplyRole = "admin"
)

type TicketObjectMeta struct {
	ContentType string
	SizeBytes   int64
}

type TicketStorage interface {
	HeadObject(ctx context.Context, objectKey string) (TicketObjectMeta, error)
	PresignUpload(ctx context.Context, objectKey, contentType string) (uploadURL string, requiredHeaders map[string]string, expiresAt int64, err error)
	PresignGet(ctx context.Context, objectKey string) (url string, expiresAt int64, err error)
	PresignGetWithResponse(ctx context.Context, objectKey string, resp TicketPresignGetResponseOptions) (url string, expiresAt int64, err error)
}

type TicketPresignGetResponseOptions struct {
	ContentDisposition string
	ContentType        string
}

var ticketSafeExtRe = regexp.MustCompile(`^\.[A-Za-z0-9]{1,10}$`)

func sanitizeTicketAttachmentExt(originalFilename string) string {
	base := path.Base(strings.TrimSpace(originalFilename))
	ext := path.Ext(base)
	if ticketSafeExtRe.MatchString(ext) {
		return ext
	}
	return ""
}

const ticketBase62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func secureRandomBase62(n int) (string, error) {
	if n <= 0 {
		return "", fmt.Errorf("invalid length")
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, n)
	for i, b := range buf {
		out[i] = ticketBase62Alphabet[int(b)%len(ticketBase62Alphabet)]
	}
	return string(out), nil
}

func normalizeDispositionParam(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "attachment":
		return "attachment"
	case "inline":
		fallthrough
	default:
		return "inline"
	}
}

func buildTicketContentDisposition(disposition, originalFilename string) (string, error) {
	disposition = normalizeDispositionParam(disposition)
	safeName, err := secureRandomBase62(12)
	if err != nil {
		return "", err
	}
	ext := sanitizeTicketAttachmentExt(originalFilename)
	return fmt.Sprintf("%s; filename=\"%s%s\"", disposition, safeName, ext), nil
}


type ticketStorageAdapter struct {
	client ticket_storage.Client
}

func (a ticketStorageAdapter) HeadObject(ctx context.Context, objectKey string) (TicketObjectMeta, error) {
	size, contentType, err := a.client.HeadObject(objectKey)
	if err != nil {
		return TicketObjectMeta{}, err
	}
	return TicketObjectMeta{ContentType: contentType, SizeBytes: size}, nil
}

func (a ticketStorageAdapter) PresignUpload(ctx context.Context, objectKey, contentType string) (string, map[string]string, int64, error) {
	url, headers, expiresAt, err := a.client.PresignUpload(objectKey, contentType, ticketStoragePresignExpire())
	if err != nil {
		return "", nil, 0, err
	}
	return url, headers, expiresAt.Unix(), nil
}

func (a ticketStorageAdapter) PresignGet(ctx context.Context, objectKey string) (string, int64, error) {
	url, expiresAt, err := a.client.PresignGet(objectKey, ticketStoragePresignExpire())
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt.Unix(), nil
}

func (a ticketStorageAdapter) PresignGetWithResponse(ctx context.Context, objectKey string, resp TicketPresignGetResponseOptions) (string, int64, error) {
	url, expiresAt, err := a.client.PresignGetWithResponse(ctx, objectKey, ticketStoragePresignExpire(), ticket_storage.PresignGetResponseOptions{
		ContentDisposition: resp.ContentDisposition,
		ContentType:        resp.ContentType,
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt.Unix(), nil
}

func defaultTicketStorage() (TicketStorage, error) {
	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, err
	}
	return ticketStorageAdapter{client: client}, nil
}

func ticketStoragePresignExpire() time.Duration {
	return 15 * time.Minute
}

var errTicketAttachmentLimitExceeded = errors.New("ticket attachment limit exceeded")

func validateTicketCategory(category string) error {
	if category != model.TicketCategoryAfterSales {
		return fmt.Errorf("invalid ticket category: %s", category)
	}
	return nil
}

func validateTicketStatus(status string) error {
	switch status {
	case model.TicketStatusOpen, model.TicketStatusProcessing, model.TicketStatusClosed:
		return nil
	default:
		return fmt.Errorf("invalid ticket status: %s", status)
	}
}

func validateReplyRole(role TicketReplyRole) error {
	switch role {
	case TicketReplyRoleUser, TicketReplyRoleAdmin:
		return nil
	default:
		return fmt.Errorf("invalid reply role: %s", role)
	}
}

func validateAttachmentsCount(existingCount int64, newCount int) error {
	if existingCount+int64(newCount) > model.TicketMaxAttachmentsPerTicket {
		return errTicketAttachmentLimitExceeded
	}
	return nil
}

func compactUniqueObjectKeys(objectKeys []string) []string {
	if len(objectKeys) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(objectKeys))
	out := make([]string, 0, len(objectKeys))
	for _, k := range objectKeys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

func nowTimestamp() int64 {
	return common.GetTimestamp()
}

func maxTicketAttachmentBytes() int64 {
	// Reuse existing global cap for file downloads/uploads.
	maxMB := constant.MaxFileDownloadMB
	if maxMB <= 0 {
		maxMB = 64
	}
	return int64(maxMB) * 1024 * 1024
}

func ensureImageContentType(contentType string) error {
	if contentType == "application/octet-stream" {
		return nil
	}
	if !strings.HasPrefix(contentType, "image/") {
		return fmt.Errorf("invalid content type: %s, required image/*", contentType)
	}
	return nil
}

func headAndValidate(ctx context.Context, storage TicketStorage, objectKey string) (TicketObjectMeta, error) {
	meta, err := storage.HeadObject(ctx, objectKey)
	if err != nil {
		return TicketObjectMeta{}, err
	}
	if err := ensureImageContentType(meta.ContentType); err != nil {
		return TicketObjectMeta{}, err
	}
	maxBytes := maxTicketAttachmentBytes()
	if meta.SizeBytes <= 0 || meta.SizeBytes > maxBytes {
		return TicketObjectMeta{}, fmt.Errorf("invalid object size: %d (max %d)", meta.SizeBytes, maxBytes)
	}
	return meta, nil
}

func validateTicketUploadOwnership(upload *model.TicketUpload, expectedUserID int) error {
	if upload.UserId != expectedUserID {
		return types.NewErrorWithStatusCode(fmt.Errorf("objectKey not owned"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	return nil
}

func validateTicketUploadReusable(upload *model.TicketUpload, now int64) error {
	if upload.UsedAt != 0 {
		return types.NewErrorWithStatusCode(fmt.Errorf("objectKey already used"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if upload.ExpiresAt != 0 && upload.ExpiresAt <= now {
		return types.NewErrorWithStatusCode(fmt.Errorf("objectKey expired"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	return nil
}

func finalizeTicketAttachments(ctx context.Context, tx *gorm.DB, storage TicketStorage, tenantId int, ticketID int, replyID int, uploaderID int, objectKeys []string, now int64) error {
	objectKeys = compactUniqueObjectKeys(objectKeys)
	if len(objectKeys) == 0 {
		return nil
	}

	var existing int64
	if err := tx.Model(&model.TicketAttachment{}).Where("ticket_id = ?", ticketID).Count(&existing).Error; err != nil {
		return err
	}
	if err := validateAttachmentsCount(existing, len(objectKeys)); err != nil {
		return err
	}

	for _, key := range objectKeys {
		var upload model.TicketUpload
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("object_key = ?", key).First(&upload).Error; err != nil {
			return err
		}
		if err := validateTicketUploadOwnership(&upload, uploaderID); err != nil {
			return err
		}
		if err := validateTicketUploadReusable(&upload, now); err != nil {
			return err
		}

		meta, err := headAndValidate(ctx, storage, key)
		if err != nil {
			return err
		}

		att := &model.TicketAttachment{
			TenantId:         tenantId,
			TicketId:         ticketID,
			ReplyId:          replyID,
			UploaderId:       uploaderID,
			ObjectKey:        key,
			OriginalFilename: upload.OriginalFilename,
			ContentType:      meta.ContentType,
			SizeBytes:        meta.SizeBytes,
			CreatedAt:        now,
		}
		if err := tx.Create(att).Error; err != nil {
			return err
		}

		upload.UsedAt = now
		upload.ContentType = meta.ContentType
		upload.SizeBytes = meta.SizeBytes
		if err := tx.Save(&upload).Error; err != nil {
			return err
		}
	}

	return nil
}

func CreateTicket(ctx context.Context, storage TicketStorage, tenantId int, userID int, subject string, content string, objectKeys []string) (*model.Ticket, *model.TicketReply, error) {
	objectKeys = compactUniqueObjectKeys(objectKeys)
	if storage == nil {
		var err error
		storage, err = defaultTicketStorage()
		if err != nil {
			return nil, nil, err
		}
	}
	if userID <= 0 {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	subject = strings.TrimSpace(subject)
	content = strings.TrimSpace(content)
	if subject == "" || content == "" {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("subject or content is empty"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if len(objectKeys) > model.TicketMaxAttachmentsPerTicket {
		return nil, nil, types.NewErrorWithStatusCode(errTicketAttachmentLimitExceeded, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var createdTicket *model.Ticket
	var createdReply *model.TicketReply

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		now := nowTimestamp()

		ticket := &model.Ticket{
			TenantId:    tenantId,
			UserId:      userID,
			Category:    model.TicketCategoryAfterSales,
			Subject:     subject,
			Status:      model.TicketStatusOpen,
			LastReplyAt: now,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := validateTicketCategory(ticket.Category); err != nil {
			return err
		}
		if err := validateTicketStatus(ticket.Status); err != nil {
			return err
		}
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}

		reply := &model.TicketReply{
			TenantId:  tenantId,
			TicketId:  ticket.Id,
			Role:      string(TicketReplyRoleUser),
			SenderId:  userID,
			Content:   content,
			CreatedAt: now,
		}
		if err := validateReplyRole(TicketReplyRole(reply.Role)); err != nil {
			return err
		}
		if err := tx.Create(reply).Error; err != nil {
			return err
		}

		if err := finalizeTicketAttachments(ctx, tx, storage, tenantId, ticket.Id, reply.Id, userID, objectKeys, now); err != nil {
			return err
		}

		createdTicket = ticket
		createdReply = reply
		return nil
	})

	if err != nil {
		return nil, nil, err
	}
	return createdTicket, createdReply, nil
}

func TicketReplyUser(ctx context.Context, tenantId int, userId int, ticketId int, content string, objectKeys []string) (*model.TicketReply, error) {
	storage, err := defaultTicketStorage()
	if err != nil {
		return nil, err
	}
	return ticketReply(ctx, storage, tenantId, TicketReplyRoleUser, userId, ticketId, content, objectKeys)
}

func TicketAdminReply(ctx context.Context, tenantId int, adminId int, ticketId int, content string, objectKeys []string) (*model.TicketReply, error) {
	storage, err := defaultTicketStorage()
	if err != nil {
		return nil, err
	}
	return ticketReply(ctx, storage, tenantId, TicketReplyRoleAdmin, adminId, ticketId, content, objectKeys)
}

func ticketReply(ctx context.Context, storage TicketStorage, tenantId int, role TicketReplyRole, senderId int, ticketId int, content string, objectKeys []string) (*model.TicketReply, error) {
	objectKeys = compactUniqueObjectKeys(objectKeys)
	if storage == nil {
		return nil, fmt.Errorf("storage is nil")
	}
	if senderId <= 0 || ticketId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid senderId/ticketId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := validateReplyRole(role); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("content is empty"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if len(objectKeys) > model.TicketMaxAttachmentsPerTicket {
		return nil, types.NewErrorWithStatusCode(errTicketAttachmentLimitExceeded, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var createdReply *model.TicketReply
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		now := nowTimestamp()

		var ticket model.Ticket
		tq := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", ticketId)
		if tenantId > 0 {
			tq = tq.Where("tenant_id = ?", tenantId)
		}
		if err := tq.First(&ticket).Error; err != nil {
			return err
		}
		if err := validateTicketCategory(ticket.Category); err != nil {
			return err
		}

		reply := &model.TicketReply{
			TenantId:  tenantId,
			TicketId:  ticket.Id,
			Role:      string(role),
			SenderId:  senderId,
			Content:   content,
			CreatedAt: now,
		}
		if err := tx.Create(reply).Error; err != nil {
			return err
		}

		// Update last reply time
		ticket.LastReplyAt = now
		ticket.UpdatedAt = now
		if err := tx.Save(&ticket).Error; err != nil {
			return err
		}

		if err := finalizeTicketAttachments(ctx, tx, storage, tenantId, ticket.Id, reply.Id, senderId, objectKeys, now); err != nil {
			return err
		}

		createdReply = reply
		return nil
	})
	if err != nil {
		return nil, err
	}
	return createdReply, nil
}

func TicketListUser(ctx context.Context, tenantId int, userId int, status string, keyword string, pageInfo *common.PageInfo) ([]model.Ticket, int64, error) {
	if userId <= 0 {
		return nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	status = strings.TrimSpace(status)
	keyword = strings.TrimSpace(keyword)
	if status != "" {
		if err := validateTicketStatus(status); err != nil {
			return nil, 0, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}

	q := model.DB.Model(&model.Ticket{}).Where("user_id = ?", userId)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
			q = q.Where("id = ? OR subject LIKE ?", id, "%"+keyword+"%")
		} else {
			q = q.Where("subject LIKE ?", "%"+keyword+"%")
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Ticket
	if err := q.Order("last_reply_at DESC").Order("created_at DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.PageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func TicketAdminList(ctx context.Context, tenantId int, status string, userId int, keyword string, pageInfo *common.PageInfo) ([]model.Ticket, int64, error) {
	status = strings.TrimSpace(status)
	keyword = strings.TrimSpace(keyword)
	if status != "" {
		if err := validateTicketStatus(status); err != nil {
			return nil, 0, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
	}
	if userId < 0 {
		return nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}

	q := model.DB.Model(&model.Ticket{})
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	if userId > 0 {
		q = q.Where("user_id = ?", userId)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if keyword != "" {
		if id, err := strconv.Atoi(keyword); err == nil && id > 0 {
			q = q.Where("id = ? OR subject LIKE ?", id, "%"+keyword+"%")
		} else {
			q = q.Where("subject LIKE ?", "%"+keyword+"%")
		}
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Ticket
	if err := q.Order("last_reply_at DESC").Order("created_at DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.PageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func TicketGetUserDetail(ctx context.Context, tenantId int, userId int, ticketId int) (model.Ticket, []model.TicketReply, []model.TicketAttachment, error) {
	if userId <= 0 || ticketId <= 0 {
		return model.Ticket{}, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid userId/ticketId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	return getTicketDetail(ctx, tenantId, ticketId, func(t *model.Ticket) error {
		if t.UserId != userId {
			return types.NewErrorWithStatusCode(fmt.Errorf("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		return nil
	})
}

func TicketAdminGetDetail(ctx context.Context, tenantId int, ticketId int) (model.Ticket, []model.TicketReply, []model.TicketAttachment, error) {
	if ticketId <= 0 {
		return model.Ticket{}, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid ticketId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	return getTicketDetail(ctx, tenantId, ticketId, nil)
}

func getTicketDetail(ctx context.Context, tenantId int, ticketId int, check func(*model.Ticket) error) (model.Ticket, []model.TicketReply, []model.TicketAttachment, error) {
	var ticket model.Ticket
	tq := model.DB.Where("id = ?", ticketId)
	if tenantId > 0 {
		tq = tq.Where("tenant_id = ?", tenantId)
	}
	if err := tq.First(&ticket).Error; err != nil {
		return model.Ticket{}, nil, nil, err
	}
	if err := validateTicketCategory(ticket.Category); err != nil {
		return model.Ticket{}, nil, nil, err
	}
	if check != nil {
		if err := check(&ticket); err != nil {
			return model.Ticket{}, nil, nil, err
		}
	}

	rq := model.DB.Where("ticket_id = ?", ticketId)
	if tenantId > 0 {
		rq = rq.Where("tenant_id = ?", tenantId)
	}
	var replies []model.TicketReply
	if err := rq.Order("created_at ASC").Find(&replies).Error; err != nil {
		return model.Ticket{}, nil, nil, err
	}
	aq := model.DB.Where("ticket_id = ?", ticketId)
	if tenantId > 0 {
		aq = aq.Where("tenant_id = ?", tenantId)
	}
	var attachments []model.TicketAttachment
	if err := aq.Order("created_at ASC").Find(&attachments).Error; err != nil {
		return model.Ticket{}, nil, nil, err
	}
	return ticket, replies, attachments, nil
}

func TicketPresignAttachmentForUser(ctx context.Context, tenantId int, userId int, attId int, disposition string) (string, int64, error) {
	if userId <= 0 || attId <= 0 {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid userId/attId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	storage, err := defaultTicketStorage()
	if err != nil {
		return "", 0, err
	}

	var att model.TicketAttachment
	aq := model.DB.Where("id = ?", attId)
	if tenantId > 0 {
		aq = aq.Where("tenant_id = ?", tenantId)
	}
	if err := aq.First(&att).Error; err != nil {
		return "", 0, err
	}
	var ticket model.Ticket
	tq := model.DB.Where("id = ?", att.TicketId)
	if tenantId > 0 {
		tq = tq.Where("tenant_id = ?", tenantId)
	}
	if err := tq.First(&ticket).Error; err != nil {
		return "", 0, err
	}
	if ticket.UserId != userId {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}

	contentDisposition, err := buildTicketContentDisposition(disposition, att.OriginalFilename)
	if err != nil {
		return "", 0, err
	}

	url, expiresAt, err := storage.PresignGetWithResponse(ctx, att.ObjectKey, TicketPresignGetResponseOptions{
		ContentDisposition: contentDisposition,
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt, nil
}

func TicketPresignAttachmentForAdmin(ctx context.Context, tenantId int, attId int, disposition string) (string, int64, error) {
	if attId <= 0 {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid attId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	storage, err := defaultTicketStorage()
	if err != nil {
		return "", 0, err
	}

	var att model.TicketAttachment
	aq := model.DB.Where("id = ?", attId)
	if tenantId > 0 {
		aq = aq.Where("tenant_id = ?", tenantId)
	}
	if err := aq.First(&att).Error; err != nil {
		return "", 0, err
	}

	contentDisposition, err := buildTicketContentDisposition(disposition, att.OriginalFilename)
	if err != nil {
		return "", 0, err
	}

	url, expiresAt, err := storage.PresignGetWithResponse(ctx, att.ObjectKey, TicketPresignGetResponseOptions{
		ContentDisposition: contentDisposition,
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt, nil
}

func TicketAdminUpdateStatus(ctx context.Context, tenantId int, adminId int, ticketId int, status string) (*model.Ticket, error) {
	_ = adminId
	if ticketId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid ticketId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	status = strings.TrimSpace(status)
	if status == "" {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("status is empty"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := validateTicketStatus(status); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var updated *model.Ticket
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		now := nowTimestamp()
		var t model.Ticket
		tq := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", ticketId)
		if tenantId > 0 {
			tq = tq.Where("tenant_id = ?", tenantId)
		}
		if err := tq.First(&t).Error; err != nil {
			return err
		}
		if err := validateTicketCategory(t.Category); err != nil {
			return err
		}
		t.Status = status
		t.UpdatedAt = now
		if err := tx.Save(&t).Error; err != nil {
			return err
		}
		updated = &t
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func TicketPresignUpload(ctx context.Context, tenantId int, userID int, filename, contentType string, sizeBytes int64) (objectKey, uploadURL string, requiredHeaders map[string]string, expiresAt int64, err error) {
	storage, err := defaultTicketStorage()
	if err != nil {
		return "", "", nil, 0, err
	}
	return TicketPresignUploadWithStorage(ctx, storage, tenantId, userID, filename, contentType, sizeBytes)
}

func TicketPresignUploadWithStorage(ctx context.Context, storage TicketStorage, tenantId int, userID int, filename, contentType string, sizeBytes int64) (objectKey, uploadURL string, requiredHeaders map[string]string, expiresAt int64, err error) {
	if storage == nil {
		return "", "", nil, 0, fmt.Errorf("storage is nil")
	}
	if userID <= 0 {
		return "", "", nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	filename = strings.TrimSpace(filename)
	contentType = strings.TrimSpace(contentType)
	if filename == "" || contentType == "" || sizeBytes <= 0 {
		return "", "", nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid filename/contentType/sizeBytes"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := ensureImageContentType(contentType); err != nil {
		return "", "", nil, 0, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if sizeBytes > maxTicketAttachmentBytes() {
		return "", "", nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("file too large"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	now := nowTimestamp()
	// Object key should be stable, unique enough, and avoid user-controlled path traversal.
	randomSuffix, err := secureRandomBase62(12)
	if err != nil {
		return "", "", nil, 0, err
	}
	objectKey = fmt.Sprintf("ticket/%d/%d_%s", userID, now, randomSuffix)

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		upload := &model.TicketUpload{
			TenantId:         tenantId,
			UserId:           userID,
			ObjectKey:        objectKey,
			OriginalFilename: filename,
			ContentType:      "",
			SizeBytes:        0,
			ExpiresAt:        now + int64(ticketStoragePresignExpire().Seconds()),
			UsedAt:           0,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		if err := tx.Create(upload).Error; err != nil {
			return err
		}

		uploadURL, requiredHeaders, expiresAt, err = storage.PresignUpload(ctx, objectKey, contentType)
		if err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return "", "", nil, 0, err
	}
	return objectKey, uploadURL, requiredHeaders, expiresAt, nil
}
