package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	InvoiceItemSourceTopUp        = "topup"
	InvoiceItemSourceSubscription = "subscription"
)

type InvoiceItem struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId  int    `json:"tenant_id" gorm:"index;default:1"`
	InvoiceId int    `json:"invoice_id" gorm:"index;uniqueIndex:uniq_invoice_item,priority:1"`
	UserId    int    `json:"user_id" gorm:"index"`

	SourceType string `json:"source_type" gorm:"type:varchar(32);index;not null;uniqueIndex:uniq_invoice_item,priority:2;uniqueIndex:uniq_invoice_source,priority:1"`
	SourceId   int    `json:"source_id" gorm:"index;not null;uniqueIndex:uniq_invoice_item,priority:3;uniqueIndex:uniq_invoice_source,priority:2"`

	// Snapshots
	TradeNo       string  `json:"trade_no" gorm:"type:varchar(255);index;not null"`
	Money         float64 `json:"money" gorm:"type:decimal(10,6);not null;default:0"`
	Currency      string  `json:"currency" gorm:"type:varchar(8);not null;default:'CNY'"`
	PaymentMethod string  `json:"payment_method" gorm:"type:varchar(50);default:''"`
	CompleteTime  int64   `json:"complete_time" gorm:"type:bigint;index"`

	// 支付宝乐企联用支付信息（invIssueChannel=5 时使用）
	PaymentCode       string `json:"payment_code" gorm:"type:varchar(64);default:''"`
	TradeNoThirdParty string `json:"trade_no_third_party" gorm:"type:varchar(128);default:''"`
	SubMchid          string `json:"sub_mchid" gorm:"type:varchar(64);default:''"`
	Account           string `json:"account" gorm:"type:varchar(128);default:''"`

	CreatedAt int64 `json:"created_at" gorm:"type:bigint;index"`
}

func (InvoiceItem) TableName() string {
	return "invoice_items"
}

func (i *InvoiceItem) BeforeCreate(tx *gorm.DB) error {
	if i.CreatedAt == 0 {
		i.CreatedAt = common.GetTimestamp()
	}
	if i.Currency == "" {
		i.Currency = InvoiceCurrencyCNY
	}
	return nil
}
