package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type InvoiceFile struct {
	Id        int `json:"id" gorm:"primaryKey;autoIncrement"`
	InvoiceId int `json:"invoice_id" gorm:"index"`

	UploaderId    int    `json:"uploader_id" gorm:"index"`
	ObjectKey     string `json:"object_key" gorm:"type:varchar(512);uniqueIndex;not null"`
	FileKind      string `json:"file_kind" gorm:"type:varchar(32);default:''"`
	Source        string `json:"source" gorm:"type:varchar(32);default:'manual'"`
	IsRed         bool   `json:"is_red" gorm:"not null;default:false;index"`
	IsUserVisible bool   `json:"is_user_visible" gorm:"not null;default:true;index"`

	OriginalFilename string `json:"original_filename" gorm:"type:varchar(255);not null;default:''"`
	ContentType      string `json:"content_type" gorm:"type:varchar(128);not null"`
	SizeBytes        int64  `json:"size_bytes" gorm:"type:bigint;not null"`

	CreatedAt int64 `json:"created_at" gorm:"type:bigint;index"`
}

func (InvoiceFile) TableName() string {
	return "invoice_files"
}

func (f *InvoiceFile) BeforeCreate(tx *gorm.DB) error {
	if f.CreatedAt == 0 {
		f.CreatedAt = common.GetTimestamp()
	}
	if f.Source == "" {
		f.Source = common.InvoiceProviderManual
	}
	return nil
}
