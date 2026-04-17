package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// CreateTopupOrderInput is what the topup controller hands in.
// AmountUnits is the "display units" value that would be stored in
// top_ups.Amount under the epay/stripe flow — i.e. already normalized
// for tokens mode (req.Amount / QuotaPerUnit). The success handler
// reconstructs internal quota via AmountUnits * QuotaPerUnit, so both
// display modes round-trip the user's original request exactly. Do NOT
// pass raw req.Amount here without normalizing — in tokens mode that
// would over-issue quota by a factor of QuotaPerUnit (e.g. 500k tokens
// requested → 250 billion tokens credited).
type CreateTopupOrderInput struct {
	TenantId    int   // order.TenantId = session tenant (收款归属)
	UserId      int   // order.UserId = payer
	AmountCents int64 // CNY cents (what WeChat charges)
	AmountUnits int64 // top_ups.Amount value; see doc above
	ProductForm string
	Openid      string // jsapi only
	ClientIp    string // h5 only
	Description string // shown on WeChat UI
	NotifyUrl   string // absolute URL the provider calls on callback
}

// CreateSubOrderInput is what the renewal controller hands in.
// AmountCents and RenewPeriodDays are both server-authoritative (read from
// TenantPlan by the caller), never from client.
type CreateSubOrderInput struct {
	TenantId        int
	UserId          int // tenant admin who initiated
	AmountCents     int64
	RenewPeriodDays int
	ProductForm     string
	Openid          string
	ClientIp        string
	Description     string
	NotifyUrl       string
}

// CreateTopupOrder inserts a pending order, calls the provider's CreateOrder,
// and returns the provider response for front-end consumption.
//
// On provider failure the pending row is KEPT (not deleted) and
// markOrderCreationError stamps LastError. Rationale: the payment
// gateway is not a transactional resource, so an HTTP-level failure
// here does not prove the remote side refused the order. A late
// callback or S3 QueryOrder must still be able to find the anchor row.
// S3 reconcile / expires_at (2h) cleans up genuinely stale pendings.
func CreateTopupOrder(ctx context.Context, in CreateTopupOrderInput) (*CreateOrderResponse, *model.PaymentOrder, error) {
	if in.TenantId <= 0 || in.UserId <= 0 || in.AmountCents <= 0 || in.AmountUnits <= 0 {
		return nil, nil, errors.New("invalid topup input")
	}
	// Metadata key name matches the applyTopupSuccess reader exactly.
	meta, _ := json.Marshal(map[string]any{"amount_units": in.AmountUnits})
	return createOrder(ctx, createOrderArgs{
		TenantId:    in.TenantId,
		UserId:      in.UserId,
		AmountCents: in.AmountCents,
		OrderType:   model.PaymentOrderTypeTopup,
		ProductForm: in.ProductForm,
		Openid:      in.Openid,
		ClientIp:    in.ClientIp,
		Description: in.Description,
		NotifyUrl:   in.NotifyUrl,
		Metadata:    string(meta),
	})
}

// CreateSubOrder inserts a pending renewal order; metadata carries the
// server-chosen renew_period_days that the callback will apply.
func CreateSubOrder(ctx context.Context, in CreateSubOrderInput) (*CreateOrderResponse, *model.PaymentOrder, error) {
	if in.TenantId <= 0 || in.UserId <= 0 || in.AmountCents <= 0 || in.RenewPeriodDays <= 0 {
		return nil, nil, errors.New("invalid sub input")
	}
	meta, _ := json.Marshal(map[string]any{"renew_period_days": in.RenewPeriodDays})
	return createOrder(ctx, createOrderArgs{
		TenantId:    in.TenantId,
		UserId:      in.UserId,
		AmountCents: in.AmountCents,
		OrderType:   model.PaymentOrderTypeSub,
		ProductForm: in.ProductForm,
		Openid:      in.Openid,
		ClientIp:    in.ClientIp,
		Description: in.Description,
		NotifyUrl:   in.NotifyUrl,
		Metadata:    string(meta),
	})
}

type createOrderArgs struct {
	TenantId    int
	UserId      int
	AmountCents int64
	OrderType   string
	ProductForm string
	Openid      string
	ClientIp    string
	Description string
	NotifyUrl   string
	Metadata    string
}

func createOrder(ctx context.Context, a createOrderArgs) (*CreateOrderResponse, *model.PaymentOrder, error) {
	switch a.ProductForm {
	case model.PaymentProductFormNative,
		model.PaymentProductFormH5,
		model.PaymentProductFormJsapi:
	default:
		return nil, nil, fmt.Errorf("unknown product form: %s", a.ProductForm)
	}
	if a.ProductForm == model.PaymentProductFormJsapi && a.Openid == "" {
		return nil, nil, errors.New("jsapi order requires openid")
	}
	if a.ProductForm == model.PaymentProductFormH5 && a.ClientIp == "" {
		return nil, nil, errors.New("h5 order requires client ip")
	}

	outTradeNo, err := model.BuildOutTradeNo(a.TenantId, a.OrderType)
	if err != nil {
		return nil, nil, err
	}

	order := &model.PaymentOrder{
		TenantId:    a.TenantId,
		UserId:      a.UserId,
		Provider:    "wechat",
		OrderType:   a.OrderType,
		ProductForm: a.ProductForm,
		OutTradeNo:  outTradeNo,
		Amount:      a.AmountCents,
		Currency:    "CNY",
		Openid:      a.Openid,
		Metadata:    a.Metadata,
	}
	if err := model.CreatePaymentOrder(order); err != nil {
		return nil, nil, fmt.Errorf("persist order: %w", err)
	}

	provider, ok := Get("wechat")
	if !ok {
		markOrderCreationError(order.OutTradeNo, "wechat provider not registered")
		return nil, nil, errors.New("wechat provider not registered")
	}
	resp, err := provider.CreateOrder(ctx, CreateOrderRequest{
		Order:       order,
		Description: a.Description,
		NotifyUrl:   a.NotifyUrl,
		Openid:      a.Openid,
		ClientIp:    a.ClientIp,
	})
	if err != nil {
		// 关键：不删本地 pending 行。HTTP timeout / 读响应失败 / TLS reset
		// 都可能是"微信已受理但本端没拿到响应"的场景；删除订单会让后续
		// 回调或 S3 QueryOrder 失去 anchor，账就对不上了。留 pending +
		// 错误留痕，由 S3 reconcile 或 expires_at(2h) 推进终态。
		markOrderCreationError(order.OutTradeNo, err.Error())
		return nil, nil, err
	}
	return resp, order, nil
}

// markOrderCreationError stamps the most recent provider-call error into
// the pending order row without deleting it. The payment gateway is NOT
// a transactional resource — an HTTP error here does not imply the
// provider failed to create the order on their side. A late callback or
// S3 QueryOrder will find this row and complete it. S3 closes genuinely
// stale rows by expires_at.
func markOrderCreationError(outTradeNo string, cause string) {
	if len(cause) > 512 {
		cause = cause[:512]
	}
	if err := model.WithTenantBypass(model.DB).
		Model(&model.PaymentOrder{}).
		Where("out_trade_no = ? AND status = ?", outTradeNo, model.PaymentOrderStatusPending).
		Updates(map[string]interface{}{
			"last_error": cause,
			"updated_at": time.Now().Unix(),
		}).Error; err != nil {
		common.SysError(fmt.Sprintf("failed to record creation error for %s: %v", outTradeNo, err))
	}
}

// ApplyPaymentSuccess is the single entry-point both the callback handler
// (controller/payment_notify.go) and the S3 reconcile loop call when an
// order transitions to paid. Idempotent: calling twice for the same
// out_trade_no is a no-op on the second call.
//
// Runs inside a DB transaction:
//  1. MarkOrderPaid pending→paid (idempotent: returns false if not flipped)
//  2. If flipped, dispatch business effect by order.OrderType:
//     - topup: Task 11
//     - sub:   Task 12
//  3. Audit log (tx variant).
//
// Cache sync / audit-log / rebate side effects run AFTER the tx commits
// via the postCommit slice, so a rolled-back tx never leaves cache or
// external state ahead of the DB.
func ApplyPaymentSuccess(ctx context.Context, outTradeNo string, transactionId string, paidAt int64) error {
	if outTradeNo == "" {
		return errors.New("empty out_trade_no")
	}
	order, err := model.GetPaymentOrderByOutTradeNo(outTradeNo)
	if err != nil {
		return fmt.Errorf("load order: %w", err)
	}

	// postCommit collects side-effects that MUST run only after the tx
	// commits — cache / redis sync, async notifications, etc. Keeping
	// them out of the tx closure avoids the classic "DB rolled back but
	// cache/quota already moved" inconsistency (see review point 2).
	var postCommit []func()

	txErr := model.WithTenantBypass(model.DB).Transaction(func(tx *gorm.DB) error {
		flipped, err := model.MarkOrderPaid(tx, outTradeNo, transactionId, paidAt)
		if err != nil {
			return err
		}
		if !flipped {
			// Already processed — nothing to do.
			return nil
		}
		// NOTE: do NOT reload via GetPaymentOrderByOutTradeNo here — that
		// helper uses the global DB, not our tx, so under RC/RR isolation
		// it would return the pre-update row (no transaction_id/paid_at).
		// Patch the in-memory struct to the exact values MarkOrderPaid
		// just wrote, so applyTopupSuccess / applySubSuccess see them.
		order.TransactionId = transactionId
		order.PaidAt = paidAt
		order.Status = model.PaymentOrderStatusPaid

		switch order.OrderType {
		case model.PaymentOrderTypeTopup:
			return applyTopupSuccess(tx, order, &postCommit)
		case model.PaymentOrderTypeSub:
			return applySubSuccess(tx, order, &postCommit)
		default:
			return fmt.Errorf("unknown order type: %s", order.OrderType)
		}
	})
	if txErr != nil {
		return txErr
	}
	for _, f := range postCommit {
		f()
	}
	return nil
}

// applyTopupSuccess and applySubSuccess are filled in by Tasks 11 and 12.
// Declared here so the transaction skeleton compiles.
// The postCommit slice lets the handler schedule cache / redis writes
// that must run *after* the tx commits (see ApplyPaymentSuccess doc).
func applyTopupSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	return errors.New("applyTopupSuccess: not implemented (Task 11)")
}
func applySubSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	return errors.New("applySubSuccess: not implemented (Task 12)")
}
