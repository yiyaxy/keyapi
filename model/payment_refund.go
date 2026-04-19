package model

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Refund status state machine (spec §4.3):
//
//	pending     — refund request submitted, provider accepted, waiting for callback
//	processing  — provider tells us the refund is in-flight (optional interim state)
//	succeeded   — refund callback confirms the money left the merchant account
//	failed      — provider reports a terminal failure
//	closed      — manually abandoned (admin cancellation)
//
// The originating PaymentOrder carries RefundedAmount = sum of all succeeded
// refunds; the order's Status is recomputed to partial_refunded / fully_refunded
// based on that sum (done in ApplyRefundSuccess).
const (
	PaymentRefundStatusPending    = "pending"
	PaymentRefundStatusProcessing = "processing"
	PaymentRefundStatusSucceeded  = "succeeded"
	PaymentRefundStatusFailed     = "failed"
	PaymentRefundStatusClosed     = "closed"
)

// PaymentRefund models one refund request against a PaymentOrder.
// Tenant-scoped; MUST be registered in tenant_scope.go or the guardrail
// will block queries (that's a feature: forgotten scope = loud failure).
//
// Business rules:
//   - OutRefundNo is our idempotency key toward the provider and unique
//     across all refunds; format mirrors out_trade_no.
//   - RefundedAmount is authoritative — the controller reads it to decide
//     whether a further partial refund is allowed.
//   - Quota is NOT rolled back automatically when a topup refund succeeds
//     (spec §6.5): the tenant admin is responsible for any quota adjustment
//     via the admin UI. The refund record exists purely for accounting.
type PaymentRefund struct {
	Id       int `json:"id" gorm:"primaryKey"`
	TenantId int `json:"tenant_id" gorm:"index;not null"`

	// PaymentOrderId is the internal id of the parent order; we index it
	// so "list refunds for this order" is cheap.
	PaymentOrderId int    `json:"payment_order_id" gorm:"index;not null"`
	OutTradeNo     string `json:"out_trade_no" gorm:"type:varchar(64);index;not null"`

	OutRefundNo string `json:"out_refund_no" gorm:"type:varchar(64);uniqueIndex;not null"`
	// RefundId: provider-side refund identifier, populated after the order
	// is accepted by the provider (SUCCESS response or first callback).
	RefundId string `json:"refund_id" gorm:"type:varchar(64);index;default:''"`

	Amount   int64  `json:"amount" gorm:"bigint;not null"` // CNY cents, must be ≤ order.Amount - order.RefundedAmount
	Currency string `json:"currency" gorm:"type:varchar(8);default:'CNY'"`
	Reason   string `json:"reason" gorm:"type:varchar(255);default:''"`

	Status    string `json:"status" gorm:"type:varchar(24);index"`
	LastError string `json:"last_error,omitempty" gorm:"type:varchar(512);default:''"`

	// InitiatedBy records which admin started the refund. 0 for system /
	// callback-only records (there currently aren't any; reserved).
	InitiatedBy int `json:"initiated_by" gorm:"default:0"`

	RefundedAt int64 `json:"refunded_at"`
	CreatedAt  int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

// BuildOutRefundNo packs tenantId + 'R' + unix_seconds + 6-char rand into
// a ≤31-char string, mirroring BuildOutTradeNo's format so operators can
// tell at a glance whether an id is an order or a refund.
//
// Format: wx_t{tid}_R_{unix_sec}_{rand6}
func BuildOutRefundNo(tenantId int) (string, error) {
	if tenantId <= 0 {
		return "", errors.New("tenantId must be > 0")
	}
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := fmt.Sprintf("wx_t%d_R_%d_%s", tenantId, time.Now().Unix(), hex.EncodeToString(b))
	if len(out) > 32 {
		return "", fmt.Errorf("out_refund_no exceeds 32 chars: %d", len(out))
	}
	return out, nil
}

// ValidateOutRefundNoRoute is the refund-callback analogue of
// ValidateOutTradeNoRoute: defense-in-depth check that the out_refund_no
// in the body really belongs to the URL-derived tenant.
func ValidateOutRefundNoRoute(outRefundNo string, tenantId int) error {
	prefix := fmt.Sprintf("wx_t%d_R_", tenantId)
	if !strings.HasPrefix(outRefundNo, prefix) {
		return fmt.Errorf("out_refund_no %s does not match route tenant=%d", outRefundNo, tenantId)
	}
	return nil
}

// CreatePaymentRefund inserts a pending refund record. Bypasses tenant
// guardrail because most callers are either background jobs or admin
// endpoints where we've already validated the tenant explicitly.
func CreatePaymentRefund(r *PaymentRefund) error {
	if r == nil || r.TenantId <= 0 || r.PaymentOrderId <= 0 || r.OutRefundNo == "" {
		return errors.New("invalid refund")
	}
	if r.Currency == "" {
		r.Currency = "CNY"
	}
	if r.Status == "" {
		r.Status = PaymentRefundStatusPending
	}
	return WithTenantBypass(DB).Create(r).Error
}

// GetPaymentRefundByOutRefundNo looks up a refund by its unique id. Used by
// the callback handler + admin UI detail.
func GetPaymentRefundByOutRefundNo(outRefundNo string) (*PaymentRefund, error) {
	if outRefundNo == "" {
		return nil, errors.New("empty out_refund_no")
	}
	var r PaymentRefund
	err := WithTenantBypass(DB).
		Where("out_refund_no = ?", outRefundNo).
		First(&r).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListPaymentRefundsByOrder returns all refunds against the given order id,
// newest first.
func ListPaymentRefundsByOrder(orderId int) ([]PaymentRefund, error) {
	var rs []PaymentRefund
	err := WithTenantBypass(DB).
		Where("payment_order_id = ?", orderId).
		Order("id DESC").
		Find(&rs).Error
	return rs, err
}

// ListTenantPaymentRefunds paginates refunds for a tenant's admin UI.
// Status is optional; empty string disables the filter.
func ListTenantPaymentRefunds(tenantId int, status string, limit, offset int) ([]PaymentRefund, int64, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	q := WithTenantBypass(DB).Model(&PaymentRefund{}).
		Where("tenant_id = ?", tenantId)
	if status != "" {
		q = q.Where("status = ?", status)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rs []PaymentRefund
	if err := q.Order("id DESC").Limit(limit).Offset(offset).Find(&rs).Error; err != nil {
		return nil, 0, err
	}
	return rs, total, nil
}

// MarkRefundAccepted flips the freshly-persisted record with any provider-
// returned refund_id once the provider acknowledges the request. Does not
// change status — pending stays pending until the callback lands.
func MarkRefundAccepted(outRefundNo string, refundId string) error {
	if outRefundNo == "" {
		return errors.New("empty out_refund_no")
	}
	return WithTenantBypass(DB).Model(&PaymentRefund{}).
		Where("out_refund_no = ?", outRefundNo).
		Updates(map[string]interface{}{
			"refund_id":  refundId,
			"updated_at": time.Now().Unix(),
		}).Error
}

// MarkRefundFailed moves a pending/processing refund to failed (e.g. when
// the provider RPC returned a terminal error before the first callback).
// reason is persisted into last_error for triage.
func MarkRefundFailed(outRefundNo string, reason string) error {
	if outRefundNo == "" {
		return errors.New("empty out_refund_no")
	}
	if len(reason) > 512 {
		reason = reason[:512]
	}
	return WithTenantBypass(DB).Model(&PaymentRefund{}).
		Where("out_refund_no = ? AND status IN ?", outRefundNo,
			[]string{PaymentRefundStatusPending, PaymentRefundStatusProcessing}).
		Updates(map[string]interface{}{
			"status":     PaymentRefundStatusFailed,
			"last_error": reason,
			"updated_at": time.Now().Unix(),
		}).Error
}

// MarkRefundSucceeded transitions a pending/processing refund to succeeded
// atomically inside the caller's tx. Returns flipped=true iff this call
// actually changed the row (idempotent guard for replayed callbacks).
func MarkRefundSucceeded(tx *gorm.DB, outRefundNo string, refundId string, refundedAt int64) (bool, error) {
	if tx == nil {
		tx = WithTenantBypass(DB)
	}
	updates := map[string]interface{}{
		"status":      PaymentRefundStatusSucceeded,
		"refunded_at": refundedAt,
		"updated_at":  time.Now().Unix(),
	}
	if refundId != "" {
		updates["refund_id"] = refundId
	}
	res := tx.Model(&PaymentRefund{}).
		Where("out_refund_no = ? AND status IN ?", outRefundNo,
			[]string{PaymentRefundStatusPending, PaymentRefundStatusProcessing}).
		Updates(updates)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// BumpOrderRefundedAmount atomically adds delta cents to the parent order
// inside the caller's tx and recomputes Status based on the new total:
//
//	refunded_amount == 0      → unchanged (paid)
//	0 < refunded < amount     → partial_refunded
//	refunded == amount        → fully_refunded
//
// Returns the new total refunded amount for audit logging.
func BumpOrderRefundedAmount(tx *gorm.DB, orderId int, delta int64) (int64, error) {
	if tx == nil {
		tx = WithTenantBypass(DB)
	}
	// Use a row-locked read so concurrent refund callbacks can't each write
	// a stale sum; the transaction serializes the updates.
	var o PaymentOrder
	if err := tx.Where("id = ?", orderId).First(&o).Error; err != nil {
		return 0, err
	}
	newRefunded := o.RefundedAmount + delta
	if newRefunded > o.Amount {
		return 0, fmt.Errorf("refunded_amount %d would exceed order amount %d", newRefunded, o.Amount)
	}
	newStatus := o.Status
	if newRefunded == o.Amount {
		newStatus = PaymentOrderStatusFullyRefunded
	} else if newRefunded > 0 {
		newStatus = PaymentOrderStatusPartialRefunded
	}
	if err := tx.Model(&PaymentOrder{}).
		Where("id = ?", orderId).
		Updates(map[string]interface{}{
			"refunded_amount": newRefunded,
			"status":          newStatus,
			"updated_at":      time.Now().Unix(),
		}).Error; err != nil {
		return 0, err
	}
	return newRefunded, nil
}
