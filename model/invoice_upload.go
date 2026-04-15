package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type InvoiceUpload struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UploaderId       int    `json:"uploader_id" gorm:"index"`
	ObjectKey        string `json:"object_key" gorm:"type:varchar(512);uniqueIndex;not null"`
	OriginalFilename string `json:"original_filename" gorm:"type:varchar(255);not null;default:''"`
	ContentType      string `json:"content_type" gorm:"type:varchar(128);default:''"`
	SizeBytes        int64  `json:"size_bytes" gorm:"type:bigint;default:0"`
	ExpiresAt        int64  `json:"expires_at" gorm:"type:bigint;index"` // 0 = never
	UsedAt           int64  `json:"used_at" gorm:"type:bigint;index"`    // 0 = unused
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;index"`
}

func (InvoiceUpload) TableName() string {
	return "invoice_uploads"
}

func (u *InvoiceUpload) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if u.CreatedAt == 0 {
		u.CreatedAt = now
	}
	return nil
}
