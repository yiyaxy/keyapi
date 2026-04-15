package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type TicketAttachment struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TicketId         int    `json:"ticket_id" gorm:"index"`
	ReplyId          int    `json:"reply_id" gorm:"index"`
	UploaderId       int    `json:"uploader_id" gorm:"index"`
	ObjectKey        string `json:"object_key" gorm:"type:varchar(512);uniqueIndex;not null"`
	OriginalFilename string `json:"original_filename" gorm:"type:varchar(255);not null;default:''"`
	ContentType      string `json:"content_type" gorm:"type:varchar(128);not null"`
	SizeBytes        int64  `json:"size_bytes" gorm:"type:bigint;not null"`
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;index"`
}

func (TicketAttachment) TableName() string {
	return "ticket_attachments"
}

func (a *TicketAttachment) BeforeCreate(tx *gorm.DB) error {
	if a.CreatedAt == 0 {
		a.CreatedAt = common.GetTimestamp()
	}
	return nil
}
