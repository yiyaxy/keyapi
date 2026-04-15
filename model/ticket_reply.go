package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type TicketReply struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TicketId  int    `json:"ticket_id" gorm:"index"`
	Role      string `json:"role" gorm:"type:varchar(16);index;not null"` // user/admin
	SenderId  int    `json:"sender_id" gorm:"index"`
	Content   string `json:"content" gorm:"type:text;not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;index"`
}

func (TicketReply) TableName() string {
	return "ticket_replies"
}

func (r *TicketReply) BeforeCreate(tx *gorm.DB) error {
	if r.CreatedAt == 0 {
		r.CreatedAt = common.GetTimestamp()
	}
	return nil
}
