package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type TicketUpload struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId         int    `json:"tenant_id" gorm:"index;default:1"`
	UserId           int    `json:"user_id" gorm:"index"`
	ObjectKey        string `json:"object_key" gorm:"type:varchar(512);uniqueIndex;not null"`
	OriginalFilename string `json:"original_filename" gorm:"type:varchar(255);not null;default:''"`
	ContentType      string `json:"content_type" gorm:"type:varchar(128);default:''"`
	SizeBytes        int64  `json:"size_bytes" gorm:"type:bigint;default:0"`
	ExpiresAt        int64  `json:"expires_at" gorm:"type:bigint;index"` // 0 = never
	UsedAt           int64  `json:"used_at" gorm:"type:bigint;index"`    // 0 = unused
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;index"`
	UpdatedAt        int64  `json:"updated_at" gorm:"type:bigint"`
}

func (TicketUpload) TableName() string {
	return "ticket_uploads"
}

func (u *TicketUpload) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if u.CreatedAt == 0 {
		u.CreatedAt = now
	}
	if u.UpdatedAt == 0 {
		u.UpdatedAt = now
	}
	return nil
}

func (u *TicketUpload) BeforeUpdate(tx *gorm.DB) error {
	u.UpdatedAt = common.GetTimestamp()
	return nil
}
