package model

const MobileChatMessageTTLSeconds int64 = 7 * 24 * 60 * 60

type MobileChatMessage struct {
	Id               int    `json:"id"`
	TenantId         int    `json:"tenant_id" gorm:"index;not null;default:1"`
	UserId           int    `json:"user_id" gorm:"index;not null"`
	Role             string `json:"role" gorm:"type:varchar(32);not null"`
	Kind             string `json:"kind" gorm:"type:varchar(32);index;default:'chat'"`
	Model            string `json:"model" gorm:"type:varchar(128);default:''"`
	ModelDisplayName string `json:"model_display_name" gorm:"type:varchar(128);default:''"`
	Content          string `json:"content" gorm:"type:text"`
	Images           string `json:"images" gorm:"type:text"`
	CreatedAtMs      int64  `json:"created_at" gorm:"bigint;index"`
	ExpiresAtMs      int64  `json:"expires_at" gorm:"bigint;index"`
	UpdatedAt        int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

func (MobileChatMessage) TableName() string {
	return "mobile_chat_messages"
}

func InsertMobileChatMessage(record *MobileChatMessage) error {
	return WithTenantBypass(DB).Create(record).Error
}

func ListMobileChatMessages(tenantId int, userId int, kind string, nowMs int64, limit int) ([]MobileChatMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var records []MobileChatMessage
	query := WithTenantBypass(DB).
		Where("tenant_id = ? AND user_id = ? AND expires_at_ms > ?", tenantId, userId, nowMs)
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	err := query.
		Order("created_at_ms ASC, id ASC").
		Limit(limit).
		Find(&records).Error
	return records, err
}

func DeleteMobileChatMessages(tenantId int, userId int, kind string) error {
	query := WithTenantBypass(DB).Where("tenant_id = ? AND user_id = ?", tenantId, userId)
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	return query.
		Delete(&MobileChatMessage{}).Error
}

func DeleteExpiredMobileChatMessages(nowMs int64) error {
	return WithTenantBypass(DB).Where("expires_at_ms <= ?", nowMs).Delete(&MobileChatMessage{}).Error
}
