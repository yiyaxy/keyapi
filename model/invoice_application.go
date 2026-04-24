package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	InvoiceTypePersonal = "personal"
	InvoiceTypeCompany  = "company"
)

const (
	InvoiceStatusPending   = "pending"
	InvoiceStatusApproved  = "approved"
	InvoiceStatusRejected  = "rejected"
	InvoiceStatusIssued    = "issued"
	InvoiceStatusCancelled = "cancelled"
)

const (
	InvoiceIssueStatusNone         = "none"
	InvoiceIssueStatusPendingIssue = "pending_issue"
	InvoiceIssueStatusIssuing      = "issuing"
	InvoiceIssueStatusQuerying     = "querying"
	InvoiceIssueStatusIssueSuccess = "issue_success"
	InvoiceIssueStatusIssueFailed  = "issue_failed"
	InvoiceIssueStatusFileReady    = "file_ready"
)

const (
	InvoiceCurrencyCNY = "CNY"
)

type InvoiceApplication struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId    int    `json:"tenant_id" gorm:"index;default:1"`
	UserId      int    `json:"user_id" gorm:"index"`
	InvoiceType string `json:"invoice_type" gorm:"type:varchar(32);index;not null"`
	Title       string `json:"title" gorm:"type:varchar(255);not null"`
	TaxId       string `json:"tax_id" gorm:"type:varchar(64);default:''"`
	Email       string `json:"email" gorm:"type:varchar(255);not null"`

	GoodsName             string `json:"goods_name" gorm:"type:varchar(255);default:''"`
	TaxClassificationCode string `json:"tax_classification_code" gorm:"type:varchar(30);default:''"`
	TaxRateValue          string `json:"tax_rate_value" gorm:"type:varchar(10);default:''"`

	ApplyRemark  string `json:"apply_remark" gorm:"type:text"`
	AdminRemark  string `json:"admin_remark" gorm:"type:text"`
	RejectReason string `json:"reject_reason" gorm:"type:text"`

	Status      string `json:"status" gorm:"type:varchar(32);index;not null;default:'pending'"`
	IssueStatus string `json:"issue_status" gorm:"type:varchar(32);index;not null;default:'none'"`
	Provider    string `json:"provider" gorm:"type:varchar(32);not null;default:'manual'"`
	IssueMode   string `json:"issue_mode" gorm:"type:varchar(32);not null;default:'manual'"`

	TotalMoney float64 `json:"total_money" gorm:"not null;default:0"`
	Currency   string  `json:"currency" gorm:"type:varchar(8);not null;default:'CNY'"`

	IssueKindCode               string `json:"issue_kind_code" gorm:"type:varchar(16);default:''"`
	PiaoTongSerialNo            string `json:"piaotong_serial_no" gorm:"type:varchar(64);index;default:''"`
	PiaoTongInvoiceReqSerialNo  string `json:"piaotong_invoice_req_serial_no" gorm:"type:varchar(64);index;default:''"`
	PiaoTongInvoiceCode         string `json:"piaotong_invoice_code" gorm:"type:varchar(64);default:''"`
	PiaoTongInvoiceNo           string `json:"piaotong_invoice_no" gorm:"type:varchar(64);default:''"`
	PiaoTongBlueAllEleInvNo     string `json:"piaotong_blue_all_ele_inv_no" gorm:"type:varchar(64);default:''"`
	PiaoTongInvoiceStatus       string `json:"piaotong_invoice_status" gorm:"type:varchar(64);default:''"`
	PiaoTongAuthId              string `json:"piaotong_auth_id" gorm:"type:varchar(64);default:''"`
	IssueAttempts               int    `json:"issue_attempts" gorm:"type:int;not null;default:0"`
	QueryAttempts               int    `json:"query_attempts" gorm:"type:int;not null;default:0"`
	LastIssueAttemptAt          int64  `json:"last_issue_attempt_at" gorm:"type:bigint;index"`
	LastQueryAt                 int64  `json:"last_query_at" gorm:"type:bigint;index"`
	NextQueryAt                 int64  `json:"next_query_at" gorm:"type:bigint;index"`
	IssueErrorCode              string `json:"issue_error_code" gorm:"type:varchar(64);default:''"`
	IssueErrorMessage           string `json:"issue_error_message" gorm:"type:text"`
	IssuePayloadSnapshot        string `json:"issue_payload_snapshot" gorm:"type:text"`
	IssueResultSnapshot         string `json:"issue_result_snapshot" gorm:"type:text"`
	FileFetchStatus             string `json:"file_fetch_status" gorm:"type:varchar(32);default:''"`
	FileFetchedAt               int64  `json:"file_fetched_at" gorm:"type:bigint;index"`

	RedStatus             string `json:"red_status" gorm:"type:varchar(32);default:''"`
	RedReason             string `json:"red_reason" gorm:"type:text"`
	RedInvoiceReqSerialNo string `json:"red_invoice_req_serial_no" gorm:"type:varchar(64);default:''"`
	RedInvoiceCode        string `json:"red_invoice_code" gorm:"type:varchar(64);default:''"`
	RedInvoiceNo          string `json:"red_invoice_no" gorm:"type:varchar(64);default:''"`
	RedSerialNo           string `json:"red_serial_no" gorm:"type:varchar(64);default:''"`
	RedAt                 int64  `json:"red_at" gorm:"type:bigint;index"`
	RedErrorMessage       string `json:"red_error_message" gorm:"type:text"`

	CreatedAt   int64 `json:"created_at" gorm:"type:bigint;index"`
	UpdatedAt   int64 `json:"updated_at" gorm:"type:bigint"`
	ApprovedAt  int64 `json:"approved_at" gorm:"type:bigint;index"`
	IssuedAt    int64 `json:"issued_at" gorm:"type:bigint;index"`
	CancelledAt int64 `json:"cancelled_at" gorm:"type:bigint;index"`
}

func (InvoiceApplication) TableName() string {
	return "invoice_applications"
}

func (a *InvoiceApplication) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if a.CreatedAt == 0 {
		a.CreatedAt = now
	}
	if a.UpdatedAt == 0 {
		a.UpdatedAt = now
	}
	if a.Status == "" {
		a.Status = InvoiceStatusPending
	}
	if a.IssueStatus == "" {
		a.IssueStatus = InvoiceIssueStatusNone
	}
	if a.Provider == "" {
		a.Provider = common.InvoiceProviderManual
	}
	if a.IssueMode == "" {
		a.IssueMode = common.InvoiceIssueModeManual
	}
	if a.Currency == "" {
		a.Currency = InvoiceCurrencyCNY
	}
	return nil
}

func (a *InvoiceApplication) BeforeUpdate(tx *gorm.DB) error {
	a.UpdatedAt = common.GetTimestamp()
	return nil
}
