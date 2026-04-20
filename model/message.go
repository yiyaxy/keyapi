package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	MessageTypeDirected  = 1 // 定向消息
	MessageTypeBroadcast = 2 // 广播消息

	MessageStatusNormal   = 1 // 正常
	MessageStatusRecalled = 2 // 已撤回
)

type Message struct {
	Id           int            `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId     int            `json:"tenant_id" gorm:"index;default:1"`
	Title        string         `json:"title" gorm:"type:varchar(255);not null"`
	Content      string         `json:"content" gorm:"type:text"`
	Type         int            `json:"type" gorm:"default:1;index"`
	TargetUserId int            `json:"target_user_id" gorm:"default:0;index"`
	SenderId     int            `json:"sender_id" gorm:"index"`
	Status       int            `json:"status" gorm:"default:1;index"`
	CreatedAt    int64          `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt    int64          `json:"updated_at" gorm:"bigint;autoUpdateTime"`
	DeletedAt    gorm.DeletedAt `json:"deleted_at" gorm:"index"`
}

type MessageReadStatus struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId  int    `json:"tenant_id" gorm:"index;default:1"`
	MessageId int    `json:"message_id" gorm:"uniqueIndex:idx_message_user"`
	UserId    int    `json:"user_id" gorm:"uniqueIndex:idx_message_user;index"`
	ReadAt    int64  `json:"read_at" gorm:"bigint"`
	ReadIP    string `json:"read_ip" gorm:"type:varchar(64)"`
	UserAgent string `json:"user_agent" gorm:"type:varchar(512)"`
}

// InboxMessage is the DTO returned to users for inbox listing
type InboxMessage struct {
	Id           int    `json:"id"`
	Title        string `json:"title"`
	Content      string `json:"content"`
	Type         int    `json:"type"`
	TargetUserId int    `json:"target_user_id"`
	SenderId     int    `json:"sender_id"`
	Status       int    `json:"status"`
	CreatedAt    int64  `json:"created_at"`
	IsRead       bool   `json:"is_read"`
	ReadAt       int64  `json:"read_at"`
}

func CreateMessage(msg *Message) error {
	msg.CreatedAt = time.Now().Unix()
	msg.UpdatedAt = msg.CreatedAt
	msg.Status = MessageStatusNormal
	return DB.Create(msg).Error
}

func GetAllMessages(tenantId int, page *common.PageInfo, keyword string, msgType int) ([]Message, int64, error) {
	var messages []Message
	var total int64

	tx := DB.Model(&Message{})
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	if keyword != "" {
		tx = tx.Where("title LIKE ?", "%"+keyword+"%")
	}
	if msgType > 0 {
		tx = tx.Where("type = ?", msgType)
	}

	err := tx.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = tx.Order("id DESC").
		Offset(page.GetStartIdx()).
		Limit(page.GetPageSize()).
		Find(&messages).Error
	return messages, total, err
}

func GetMessageById(tenantId int, id int) (*Message, error) {
	var msg Message
	tx := DB.Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	err := tx.First(&msg).Error
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

func UpdateMessage(tenantId int, id int, updates map[string]interface{}) (int64, error) {
	if tenantId <= 0 || id <= 0 {
		return 0, errors.New("tenantId 和 id 不能为空")
	}
	updates["updated_at"] = time.Now().Unix()
	result := DB.Model(&Message{}).
		Where("id = ? AND tenant_id = ?", id, tenantId).
		Updates(updates)
	return result.RowsAffected, result.Error
}

func RecallMessage(tenantId int, id int) (int64, error) {
	if tenantId <= 0 || id <= 0 {
		return 0, errors.New("tenantId 和 id 不能为空")
	}
	now := time.Now().Unix()
	result := DB.Model(&Message{}).
		Where("id = ? AND tenant_id = ?", id, tenantId).
		Updates(map[string]interface{}{
			"status":     MessageStatusRecalled,
			"updated_at": now,
			"deleted_at": time.Now(),
		})
	return result.RowsAffected, result.Error
}

func GetUserInbox(tenantId int, userId int, page *common.PageInfo) ([]InboxMessage, int64, error) {
	var total int64
	var results []InboxMessage

	// Count visible messages for this user
	countTx := DB.Model(&Message{}).
		Where("status = ?", MessageStatusNormal).
		Where("(type = ? AND target_user_id = ?) OR type = ?",
			MessageTypeDirected, userId, MessageTypeBroadcast)
	if tenantId > 0 {
		countTx = countTx.Where("tenant_id = ?", tenantId)
	}
	if err := countTx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Query with LEFT JOIN for read status
	queryTx := DB.Table("messages m").
		Select(`m.id, m.title, m.content, m.type, m.target_user_id, m.sender_id, m.status, m.created_at,
			CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as is_read,
			COALESCE(r.read_at, 0) as read_at`).
		Joins("LEFT JOIN message_read_statuses r ON r.message_id = m.id AND r.user_id = ?", userId).
		Where("m.status = ?", MessageStatusNormal).
		Where("m.deleted_at IS NULL").
		Where("(m.type = ? AND m.target_user_id = ?) OR m.type = ?",
			MessageTypeDirected, userId, MessageTypeBroadcast)
	if tenantId > 0 {
		queryTx = queryTx.Where("m.tenant_id = ?", tenantId)
	}
	err := queryTx.Order("m.id DESC").
		Offset(page.GetStartIdx()).
		Limit(page.GetPageSize()).
		Scan(&results).Error

	return results, total, err
}

func GetUserInboxMessage(tenantId int, userId int, messageId int) (*InboxMessage, error) {
	var result InboxMessage
	queryTx := DB.Table("messages m").
		Select(`m.id, m.title, m.content, m.type, m.target_user_id, m.sender_id, m.status, m.created_at,
			CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as is_read,
			COALESCE(r.read_at, 0) as read_at`).
		Joins("LEFT JOIN message_read_statuses r ON r.message_id = m.id AND r.user_id = ?", userId).
		Where("m.id = ?", messageId).
		Where("m.status = ?", MessageStatusNormal).
		Where("m.deleted_at IS NULL").
		Where("(m.type = ? AND m.target_user_id = ?) OR m.type = ?",
			MessageTypeDirected, userId, MessageTypeBroadcast)
	if tenantId > 0 {
		queryTx = queryTx.Where("m.tenant_id = ?", tenantId)
	}
	err := queryTx.Scan(&result).Error
	if err != nil {
		return nil, err
	}
	if result.Id == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &result, nil
}

func MarkMessageAsRead(tenantId int, userId, messageId int, ip, userAgent string) error {
	now := time.Now().Unix()
	readStatus := MessageReadStatus{
		TenantId:  tenantId,
		MessageId: messageId,
		UserId:    userId,
		ReadAt:    now,
		ReadIP:    ip,
		UserAgent: userAgent,
	}
	// Use ON CONFLICT to avoid duplicate insert
	query := DB.Where("message_id = ? AND user_id = ?", messageId, userId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	return query.FirstOrCreate(&readStatus).Error
}

func GetUnreadCount(tenantId int, userId int) (int64, error) {
	var count int64
	// 子查询也必须带 tenant_id —— message_read_statuses 是租户隔离表，
	// 不带条件会被 guardrail 拦住（子查询执行失败 → 主查询得到 NOT IN ()
	// 这种空括号，进而 SQL 语法错）。
	readSubQuery := DB.Model(&MessageReadStatus{}).
		Select("message_id").
		Where("tenant_id = ? AND user_id = ?", tenantId, userId)
	tx := DB.Model(&Message{}).
		Where("tenant_id = ?", tenantId).
		Where("status = ?", MessageStatusNormal).
		Where("(type = ? AND target_user_id = ?) OR type = ?",
			MessageTypeDirected, userId, MessageTypeBroadcast).
		Where("id NOT IN (?)", readSubQuery)
	err := tx.Count(&count).Error
	return count, err
}

func GetMessageReadStatuses(tenantId int, messageId int, page *common.PageInfo) ([]MessageReadStatus, int64, error) {
	var statuses []MessageReadStatus
	var total int64

	tx := DB.Model(&MessageReadStatus{}).Where("message_id = ?", messageId)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := tx.Order("read_at DESC").
		Offset(page.GetStartIdx()).
		Limit(page.GetPageSize()).
		Find(&statuses).Error
	return statuses, total, err
}
