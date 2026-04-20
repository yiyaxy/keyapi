package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	TicketCategoryAfterSales = "after_sales"
)

const (
	TicketStatusOpen       = "open"
	TicketStatusProcessing = "processing"
	TicketStatusClosed     = "closed"
)

const (
	TicketMaxAttachmentsPerTicket = 5
)

type Ticket struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId    int    `json:"tenant_id" gorm:"index;default:1"`
	UserId      int    `json:"user_id" gorm:"index"`
	Category    string `json:"category" gorm:"type:varchar(32);index;not null"`
	Subject     string `json:"subject" gorm:"type:varchar(255);not null"`
	Status      string `json:"status" gorm:"type:varchar(32);index;not null;default:'open'"`
	LastReplyAt int64  `json:"last_reply_at" gorm:"type:bigint;index"`
	CreatedAt   int64  `json:"created_at" gorm:"type:bigint;index"`
	UpdatedAt   int64  `json:"updated_at" gorm:"type:bigint"`
}

func (Ticket) TableName() string {
	return "tickets"
}

func (t *Ticket) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if t.CreatedAt == 0 {
		t.CreatedAt = now
	}
	if t.UpdatedAt == 0 {
		t.UpdatedAt = now
	}
	if t.LastReplyAt == 0 {
		t.LastReplyAt = now
	}
	if t.Category == "" {
		t.Category = TicketCategoryAfterSales
	}
	if t.Status == "" {
		t.Status = TicketStatusOpen
	}
	return nil
}

func (t *Ticket) BeforeUpdate(tx *gorm.DB) error {
	t.UpdatedAt = common.GetTimestamp()
	return nil
}
