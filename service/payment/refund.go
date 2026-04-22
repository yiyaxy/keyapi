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
	// UserQuotaDelta is the raw quota the admin wants reclaimed from the
	// payer's balance on refund success. 0 = don't touch quota (historical
	// default). Non-negative; enforced here and clamped at apply time so
	// the user never goes negative even if they spent the topup already.
	UserQuotaDelta int64
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
	quotaDelta := in.UserQuotaDelta
	if quotaDelta < 0 {
		quotaDelta = 0
	}
	// Only topup orders credit quota; subscription renewals bump
	// tenant_plans.expires_at instead, so quota deduction on refund is
	// nonsensical there. Force to 0.
	if order.OrderType != model.PaymentOrderTypeTopup {
		quotaDelta = 0
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
		UserQuotaDelta: quotaDelta,
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

// postCommitDeduct captures what a successful refund needs to do to the
// user's in-memory cache after the DB tx lands.
type postCommitDeduct struct {
	userId int
	delta  int64 // negative for deduction; 0 = skip
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

	// Resolve the payer and their home tenant once up front so we can
	// run the deduction inside the same tx as the refund state transition.
	// We do this BEFORE the tx so a failed lookup doesn't roll the refund
	// state back — the refund should still succeed financially even if
	// we can't reach the user row for some reason.
	var payerUserId, payerHomeTenant int
	if refund.UserQuotaDelta > 0 {
		order, oerr := model.GetPaymentOrderByOutTradeNo(refund.OutTradeNo)
		if oerr == nil && order != nil && order.OrderType == model.PaymentOrderTypeTopup {
			payerUserId = order.UserId
			if tenantId, terr := model.GetUserTenantId(payerUserId); terr == nil {
				payerHomeTenant = tenantId
			} else {
				common.SysLog(fmt.Sprintf("refund: failed to resolve payer home tenant for user %d: %v", payerUserId, terr))
			}
		}
	}

	postCommit := postCommitDeduct{userId: payerUserId, delta: 0}

	txErr := model.WithTenantBypass(model.DB).Transaction(func(tx *gorm.DB) error {
		// Compute actual deduction inside the tx so reads are consistent
		// with the update we're about to make.
		actualDelta := int64(0)
		if refund.UserQuotaDelta > 0 && payerUserId > 0 && payerHomeTenant > 0 {
			var currentQuota int64
			if err := tx.Raw(
				"SELECT quota FROM users WHERE id = ? AND tenant_id = ?",
				payerUserId, payerHomeTenant,
			).Scan(&currentQuota).Error; err != nil {
				common.SysLog(fmt.Sprintf("refund deduct lookup failed user=%d: %v", payerUserId, err))
				currentQuota = 0
			}
			// Clamp to 0 — never drive the user negative even if they've
			// already spent the topup beyond what we're trying to reclaim.
			actualDelta = refund.UserQuotaDelta
			if actualDelta > currentQuota {
				actualDelta = currentQuota
			}
			if actualDelta > 0 {
				res := tx.Exec(
					"UPDATE users SET quota = quota - ? WHERE id = ? AND tenant_id = ?",
					actualDelta, payerUserId, payerHomeTenant,
				)
				if res.Error != nil {
					return fmt.Errorf("deduct user quota: %w", res.Error)
				}
				if res.RowsAffected != 1 {
					return fmt.Errorf("quota deduct affected %d rows (user=%d, home=%d)",
						res.RowsAffected, payerUserId, payerHomeTenant)
				}
			}
		}
		postCommit.delta = -actualDelta

		flipped, err := model.MarkRefundSucceeded(tx, outRefundNo, refundId, refundedAt, actualDelta)
		if err != nil {
			return err
		}
		if !flipped {
			// Idempotent re-entry — nothing further to do. But if we did
			// the deduction above, that's a bug (we wouldn't flip twice
			// because the WHERE status IN (...) guard would block). Leave
			// the postCommit cache invalidation running anyway — it's a no-op
			// on repeat.
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
				"out_trade_no":          refund.OutTradeNo,
				"out_refund_no":         refund.OutRefundNo,
				"refund_id":             refundId,
				"amount_cents":          refund.Amount,
				"order_refunded_now":    newTotal,
				"quota_delta_requested": refund.UserQuotaDelta,
				"quota_delta_applied":   actualDelta,
				"payer_user_id":         payerUserId,
				"payer_home_tenant":     payerHomeTenant,
			}),
		}); err != nil {
			common.SysLog(fmt.Sprintf("refund audit tx-write failed: %v", err))
		}
		return nil
	})
	if txErr != nil {
		return txErr
	}

	// Sync the user-quota cache after the tx commits — the topup path
	// does the mirror of this on credit. If the cache sync fails we log
	// but don't error; cache will re-converge next read.
	if postCommit.delta < 0 {
		if err := model.CacheIncrUserQuota(postCommit.userId, postCommit.delta); err != nil {
			common.SysLog(fmt.Sprintf("refund cache sync failed user=%d: %v", postCommit.userId, err))
		}
	}
	return nil
}
