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

// Order type constants ({topup | sub}) — used by both router paths and
// order_type column. BuildOutTradeNo maps them to a 1-char kind (T/S)
// packed into out_trade_no to stay within the 32-char WeChat limit.
const (
	PaymentOrderTypeTopup = "topup"
	PaymentOrderTypeSub   = "sub"
)

// Order status constants. See spec §4.2 state machine.
const (
	PaymentOrderStatusPending         = "pending"
	PaymentOrderStatusPaid            = "paid"
	PaymentOrderStatusPartialRefunded = "partial_refunded"
	PaymentOrderStatusFullyRefunded   = "fully_refunded"
	PaymentOrderStatusClosed          = "closed"
	PaymentOrderStatusExpired         = "expired"
)

// Product form constants. Picks which WeChat ordering API is used.
const (
	PaymentProductFormNative    = "native"
	PaymentProductFormH5        = "h5"
	PaymentProductFormJsapi     = "jsapi"
	PaymentProductFormXpayGoods = "xpay_goods"
)

// PaymentOrder models one external payment order across all providers.
// S1 invariant: registered tenant-scoped; all queries must use
// WithTenantBypass + explicit WHERE tenant_id=? OR request ctx with
// middleware.GetTenantId (spec §4).
type PaymentOrder struct {
	Id       int `json:"id" gorm:"primaryKey"`
	TenantId int `json:"tenant_id" gorm:"index;not null"` // 收款归属锚点，见 §11.1
	UserId   int `json:"user_id" gorm:"index"`            // topup=充值用户; sub=租户 admin

	Provider    string `json:"provider" gorm:"type:varchar(32);index"`   // "wechat"
	OrderType   string `json:"order_type" gorm:"type:varchar(16);index"` // "topup" | "sub"
	ProductForm string `json:"product_form" gorm:"type:varchar(16)"`     // "native" | "h5" | "jsapi"

	OutTradeNo    string `json:"out_trade_no" gorm:"type:varchar(64);uniqueIndex"`
	TransactionId string `json:"transaction_id" gorm:"type:varchar(64);index"` // 微信返回

	Amount   int64  `json:"amount" gorm:"bigint;not null"` // 单位：分
	Currency string `json:"currency" gorm:"type:varchar(8);default:'CNY'"`

	// RefundedAmount: 累计已退款，S3 才会被写入。
	// Status 由 Amount/RefundedAmount 的关系 + 生命周期事件共同决定 — 见 §4.2。
	RefundedAmount int64  `json:"refunded_amount" gorm:"bigint;default:0"`
	Status         string `json:"status" gorm:"type:varchar(24);index"`

	Openid   string `json:"openid,omitempty" gorm:"type:varchar(128)"` // JSAPI 场景
	Metadata string `json:"metadata" gorm:"type:text"`                 // JSON
	// LastError: 最近一次下单失败 / 回调异常的原因。下单 RPC 失败时我们
	// **不删** 本地 pending 行（微信可能已经受理），而是留痕在这里，
	// 由 S3 reconcile 的 QueryOrder 推进终态，或 expires_at 到期后标 expired。
	LastError string `json:"last_error,omitempty" gorm:"type:varchar(512);default:''"`

	PaidAt    int64 `json:"paid_at"`
	ExpiresAt int64 `json:"expires_at"` // 下单 + 2h，超时标 expired
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

// BuildOutTradeNo packs tenantId + kind(T/S) + unix_seconds + 6-char rand
// into a ≤31-char string (tenantId up to 7 digits).
//
// Format: wx_t{tid}_{K}_{unix_sec}_{rand6}
//
//	K = 'T' for topup, 'S' for sub
//
// The rand6 comes from crypto/rand hex (3 bytes → 6 hex chars).
func BuildOutTradeNo(tenantId int, orderType string) (string, error) {
	if tenantId <= 0 {
		return "", errors.New("tenantId must be > 0")
	}
	var kind string
	switch orderType {
	case PaymentOrderTypeTopup:
		kind = "T"
	case PaymentOrderTypeSub:
		kind = "S"
	default:
		return "", fmt.Errorf("unknown order type: %s", orderType)
	}
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := fmt.Sprintf("wx_t%d_%s_%d_%s", tenantId, kind, time.Now().Unix(), hex.EncodeToString(b))
	if len(out) > 32 {
		return "", fmt.Errorf("out_trade_no exceeds 32 chars: %d", len(out))
	}
	return out, nil
}

// ValidateOutTradeNoRoute checks the out_trade_no prefix matches the
// URL-derived tenantId and order_type. Used in the notify handler
// (spec §7.4) as a defense-in-depth check beyond the signature.
func ValidateOutTradeNoRoute(outTradeNo string, tenantId int, orderType string) error {
	var kind string
	switch orderType {
	case PaymentOrderTypeTopup:
		kind = "T"
	case PaymentOrderTypeSub:
		kind = "S"
	default:
		return fmt.Errorf("unknown order type: %s", orderType)
	}
	prefix := fmt.Sprintf("wx_t%d_%s_", tenantId, kind)
	if !strings.HasPrefix(outTradeNo, prefix) {
		return fmt.Errorf("out_trade_no %s does not match route tenant=%d type=%s",
			outTradeNo, tenantId, orderType)
	}
	return nil
}

// CreatePaymentOrder inserts a pending order. Uses WithTenantBypass since
// most call sites are non-request-ctx (reconcile, worker). Caller owns the
// struct — OutTradeNo must be set via BuildOutTradeNo first.
func CreatePaymentOrder(order *PaymentOrder) error {
	if order == nil || order.TenantId <= 0 || order.OutTradeNo == "" {
		return errors.New("invalid order")
	}
	if order.Provider == "" {
		order.Provider = "wechat"
	}
	if order.Currency == "" {
		order.Currency = "CNY"
	}
	if order.Status == "" {
		order.Status = PaymentOrderStatusPending
	}
	now := time.Now().Unix()
	if order.ExpiresAt == 0 {
		order.ExpiresAt = now + 2*3600 // 2h order TTL
	}
	return WithTenantBypass(DB).Create(order).Error
}

// GetPaymentOrderByOutTradeNo looks up an order by its unique out_trade_no.
// Used by callbacks, query API, reconcile loop, and UI detail.
// Callers MUST check order.TenantId matches whatever scope they are in.
func GetPaymentOrderByOutTradeNo(outTradeNo string) (*PaymentOrder, error) {
	if outTradeNo == "" {
		return nil, errors.New("empty out_trade_no")
	}
	var o PaymentOrder
	err := WithTenantBypass(DB).
		Where("out_trade_no = ?", outTradeNo).
		First(&o).Error
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// MarkOrderPaid transitions pending → paid atomically. Returns:
//   - (true, nil)  if this call flipped the status (i.e., business effects
//     should run)
//   - (false, nil) if already in a post-pending state (idempotent no-op)
//   - (false, err) on db failure
//
// ApplyPaymentSuccess is the only caller; it runs this inside a tx.
func MarkOrderPaid(tx *gorm.DB, outTradeNo string, transactionId string, paidAt int64) (bool, error) {
	if tx == nil {
		tx = WithTenantBypass(DB)
	}
	res := tx.Model(&PaymentOrder{}).
		Where("out_trade_no = ? AND status = ?", outTradeNo, PaymentOrderStatusPending).
		Updates(map[string]interface{}{
			"status":         PaymentOrderStatusPaid,
			"transaction_id": transactionId,
			"paid_at":        paidAt,
			"updated_at":     time.Now().Unix(),
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// markOrderPendingTo is the generic pending→terminal transition used by the
// reconcile loop for non-success outcomes. reason is persisted into last_error
// for audit. Returns (true, nil) if flipped, (false, nil) if already in a
// post-pending state.
func markOrderPendingTo(outTradeNo string, newStatus string, reason string) (bool, error) {
	if outTradeNo == "" {
		return false, errors.New("empty out_trade_no")
	}
	if len(reason) > 512 {
		reason = reason[:512]
	}
	res := WithTenantBypass(DB).Model(&PaymentOrder{}).
		Where("out_trade_no = ? AND status = ?", outTradeNo, PaymentOrderStatusPending).
		Updates(map[string]interface{}{
			"status":     newStatus,
			"last_error": reason,
			"updated_at": time.Now().Unix(),
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// MarkOrderExpired flips pending → expired. Used by the reconcile loop when
// an order is past ExpiresAt and the provider reports a non-success state.
func MarkOrderExpired(outTradeNo string, reason string) (bool, error) {
	return markOrderPendingTo(outTradeNo, PaymentOrderStatusExpired, reason)
}

// MarkOrderClosed flips pending → closed. Used when the provider reports
// a terminal non-success state (CLOSED / PAYERROR / REVOKED) independent of
// our own ExpiresAt.
func MarkOrderClosed(outTradeNo string, reason string) (bool, error) {
	return markOrderPendingTo(outTradeNo, PaymentOrderStatusClosed, reason)
}

// ListPendingPaymentOrdersForReconcile returns pending orders for the given
// provider whose creation time is at least `graceSeconds` in the past.
// Ordered oldest-first and capped at `limit`. Used by the reconcile sweep.
//
// The grace window lets the normal callback path resolve fresh orders
// without us hitting the provider's QueryOrder API for every single one.
func ListPendingPaymentOrdersForReconcile(provider string, graceSeconds int64, limit int) ([]PaymentOrder, error) {
	if limit <= 0 {
		limit = 200
	}
	cutoff := time.Now().Unix() - graceSeconds
	var orders []PaymentOrder
	err := WithTenantBypass(DB).
		Where("provider = ? AND status = ? AND created_at <= ?",
			provider, PaymentOrderStatusPending, cutoff).
		Order("created_at ASC").
		Limit(limit).
		Find(&orders).Error
	return orders, err
}
