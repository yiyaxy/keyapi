package payment

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// CreateRefundInput is the admin-side handoff into refund creation.
type CreateRefundInput struct {
	TenantId    int
	InitiatedBy int    // admin user id initiating the refund (for audit)
	OutTradeNo  string // parent order
	AmountCents int64  // ≤ order.Amount - order.RefundedAmount
	Reason      string // shown on user's WeChat UI (optional)
	NotifyUrl   string // absolute refund callback URL
}

// CreateRefund persists a pending PaymentRefund, asks WeChat to accept the
// refund, and on success stamps refund_id back onto the row. On provider
// failure the row is marked failed but KEPT, so operators can see what
// was attempted.
//
// Refunds are deliberately NOT auto-applied to user quota on success — the
// spec (§6.5) requires a tenant admin to make any quota adjustment by hand.
// This function covers accounting + state only.
func CreateRefund(ctx context.Context, in CreateRefundInput) (*model.PaymentRefund, error) {
	if in.TenantId <= 0 || in.OutTradeNo == "" || in.AmountCents <= 0 {
		return nil, errors.New("invalid refund input")
	}

	order, err := model.GetPaymentOrderByOutTradeNo(in.OutTradeNo)
	if err != nil {
		return nil, fmt.Errorf("load order: %w", err)
	}
	if order.TenantId != in.TenantId {
		// Cross-tenant access: treat as not-found to avoid leaking existence.
		return nil, gorm.ErrRecordNotFound
	}
	// Only paid / partial_refunded orders can be refunded further.
	if order.Status != model.PaymentOrderStatusPaid &&
		order.Status != model.PaymentOrderStatusPartialRefunded {
		return nil, fmt.Errorf("order status %q cannot be refunded", order.Status)
	}
	remaining := order.Amount - order.RefundedAmount
	if in.AmountCents > remaining {
		return nil, fmt.Errorf("refund amount %d exceeds remaining refundable %d",
			in.AmountCents, remaining)
	}

	outRefundNo, err := model.BuildOutRefundNo(in.TenantId)
	if err != nil {
		return nil, err
	}
	refund := &model.PaymentRefund{
		TenantId:       in.TenantId,
		PaymentOrderId: order.Id,
		OutTradeNo:     order.OutTradeNo,
		OutRefundNo:    outRefundNo,
		Amount:         in.AmountCents,
		Currency:       order.Currency,
		Reason:         in.Reason,
		Status:         model.PaymentRefundStatusPending,
		InitiatedBy:    in.InitiatedBy,
	}
	if err := model.CreatePaymentRefund(refund); err != nil {
		return nil, fmt.Errorf("persist refund: %w", err)
	}

	provider, ok := Get(order.Provider)
	if !ok {
		_ = model.MarkRefundFailed(outRefundNo, "provider not registered: "+order.Provider)
		return refund, fmt.Errorf("provider not registered: %s", order.Provider)
	}

	result, err := provider.Refund(ctx, RefundRequest{
		Order:          order,
		Refund:         refund,
		OriginalAmount: order.Amount,
		NotifyUrl:      in.NotifyUrl,
		Reason:         in.Reason,
	})
	if err != nil {
		// Keep the row (WeChat may have received it even if the RPC failed)
		// but flag it so operators can retry manually via the admin UI.
		// A genuinely-duplicate out_refund_no would surface as a specific
		// WeChat error here; we don't translate because the raw error is
		// more actionable for humans.
		_ = model.MarkRefundFailed(outRefundNo, err.Error())
		return refund, fmt.Errorf("provider refund: %w", err)
	}

	// Provider accepted. Stamp refund_id onto the row. If WeChat already
	// reported SUCCESS synchronously (rare but possible for wallet balance
	// refunds), drive the state transition immediately — otherwise wait
	// for the callback.
	if result.RefundId != "" {
		if err := model.MarkRefundAccepted(outRefundNo, result.RefundId); err != nil {
			common.SysLog(fmt.Sprintf("mark refund accepted failed %s: %v", outRefundNo, err))
		}
		refund.RefundId = result.RefundId
	}
	if result.RefundStatus == "SUCCESS" {
		when := result.SuccessTime
		if when == 0 {
			when = time.Now().Unix()
		}
		if err := ApplyRefundSuccess(ctx, outRefundNo, result.RefundId, when, refund.Amount); err != nil {
			common.SysLog(fmt.Sprintf("sync-success refund apply failed %s: %v", outRefundNo, err))
		}
	}
	return refund, nil
}

// ApplyRefundSuccess is the single entry-point for the refund-success
// transition; called by both the callback handler and the sync-success
// path in CreateRefund. Idempotent.
//
// Inside the tx:
//  1. MarkRefundSucceeded pending→succeeded (idempotent).
//  2. BumpOrderRefundedAmount updates the parent order's refunded_amount
//     and recomputes its Status (paid → partial_refunded → fully_refunded).
//  3. Audit log.
//
// amountCents is redundant (we could re-read the refund row) but passing
// it explicitly lets callers sanity-check the callback body against our
// stored record before invoking us.
func ApplyRefundSuccess(ctx context.Context, outRefundNo string, refundId string, refundedAt int64, amountCents int64) error {
	if outRefundNo == "" {
		return errors.New("empty out_refund_no")
	}
	refund, err := model.GetPaymentRefundByOutRefundNo(outRefundNo)
	if err != nil {
		return fmt.Errorf("load refund: %w", err)
	}
	if amountCents > 0 && refund.Amount != amountCents {
		return fmt.Errorf("refund callback amount %d disagrees with stored %d",
			amountCents, refund.Amount)
	}

	return model.WithTenantBypass(model.DB).Transaction(func(tx *gorm.DB) error {
		flipped, err := model.MarkRefundSucceeded(tx, outRefundNo, refundId, refundedAt)
		if err != nil {
			return err
		}
		if !flipped {
			return nil
		}
		newTotal, err := model.BumpOrderRefundedAmount(tx, refund.PaymentOrderId, refund.Amount)
		if err != nil {
			return err
		}
		if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
			TenantId:    refund.TenantId,
			ActorUserId: refund.InitiatedBy,
			Action:      "payment.refund.success",
			Target:      "payment_refunds",
			TargetId:    refund.Id,
			Detail: mustJSON(map[string]any{
				"out_trade_no":       refund.OutTradeNo,
				"out_refund_no":      refund.OutRefundNo,
				"refund_id":          refundId,
				"amount_cents":       refund.Amount,
				"order_refunded_now": newTotal,
			}),
		}); err != nil {
			common.SysLog(fmt.Sprintf("refund audit tx-write failed: %v", err))
		}
		return nil
	})
}
