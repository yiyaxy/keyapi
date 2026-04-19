package payment

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Reconcile loop: periodically scans pending payment orders and refreshes
// their state from the provider (spec §6.4).
//
// Why this exists: the WeChat callback is best-effort. A callback can be lost
// to a network blip, a brief outage, or a signature-verification failure that
// the provider then backs off on. Without a reconcile path, the user has paid
// but our DB still says pending → we never credit their quota / extend their
// plan.
//
// The sweep:
//   1. Finds pending orders older than ReconcileGraceSeconds (so we don't
//      thrash fresh orders still in the normal callback window).
//   2. For each order, asks the provider what state WeChat has.
//   3. Transitions the order according to the reply:
//        SUCCESS                             → ApplyPaymentSuccess
//        CLOSED / PAYERROR / REVOKED         → MarkOrderClosed
//        NOTPAY / USERPAYING (past ExpiresAt)→ MarkOrderExpired
//        NOTPAY / USERPAYING (still valid)   → leave pending, next sweep
//      On provider error the order is left pending too — the next sweep retries.

const (
	// ReconcileGraceSeconds is the minimum age a pending order must have
	// before reconcile touches it. Gives the normal callback path a fair
	// chance to resolve without us hitting WeChat's QueryOrder API.
	ReconcileGraceSeconds int64 = 120

	// ReconcileBatchSize caps how many orders one sweep processes. With
	// per-call WeChat QueryOrder latency ~200ms this bounds sweep duration
	// to ~40s at the limit, well within the 5-min interval.
	ReconcileBatchSize = 200

	// reconcilePerCallTimeout applies to each provider QueryOrder RPC so
	// a single hung call doesn't stall the whole sweep.
	reconcilePerCallTimeout = 8 * time.Second
)

// reconcileProviders is the list of providers the sweep walks. For now only
// wechat; future providers (alipay, stripe-cn) just append here.
var reconcileProviders = []string{"wechat"}

// StartPaymentReconcileLoop runs RunPaymentReconcileSweep every `interval`.
// Intended to be launched from main.go inside a gopool.Go on master nodes.
func StartPaymentReconcileLoop(interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	RunPaymentReconcileSweep()
	for range ticker.C {
		RunPaymentReconcileSweep()
	}
}

// RunPaymentReconcileSweep walks every registered provider once.
// Safe to call from a one-off cron entry or an operator CLI — it does not
// rely on being the only caller.
func RunPaymentReconcileSweep() {
	for _, name := range reconcileProviders {
		if err := runReconcileForProvider(context.Background(), name); err != nil {
			common.SysError(fmt.Sprintf("payment reconcile %s sweep failed: %s", name, err.Error()))
		}
	}
}

func runReconcileForProvider(ctx context.Context, providerName string) error {
	provider, ok := Get(providerName)
	if !ok {
		// Provider not registered (e.g. alipay in the future). Quietly skip
		// — this is not an error, just "we don't reconcile what we don't
		// know how to talk to".
		return nil
	}

	orders, err := model.ListPendingPaymentOrdersForReconcile(
		providerName, ReconcileGraceSeconds, ReconcileBatchSize,
	)
	if err != nil {
		return fmt.Errorf("list pending orders: %w", err)
	}
	if len(orders) == 0 {
		return nil
	}

	var paidCount, expiredCount, closedCount, errCount, skippedCount int
	for i := range orders {
		o := &orders[i]
		outcome := reconcileOneOrder(ctx, provider, o)
		switch outcome {
		case reconcileOutcomePaid:
			paidCount++
		case reconcileOutcomeExpired:
			expiredCount++
		case reconcileOutcomeClosed:
			closedCount++
		case reconcileOutcomeError:
			errCount++
		default:
			skippedCount++
		}
	}

	common.SysLog(fmt.Sprintf(
		"payment reconcile %s sweep: scanned=%d paid=%d expired=%d closed=%d errors=%d skipped=%d",
		providerName, len(orders), paidCount, expiredCount, closedCount, errCount, skippedCount,
	))
	return nil
}

type reconcileOutcome int

const (
	reconcileOutcomeSkipped reconcileOutcome = iota
	reconcileOutcomePaid
	reconcileOutcomeExpired
	reconcileOutcomeClosed
	reconcileOutcomeError
)

func reconcileOneOrder(ctx context.Context, provider Provider, o *model.PaymentOrder) reconcileOutcome {
	callCtx, cancel := context.WithTimeout(ctx, reconcilePerCallTimeout)
	defer cancel()

	result, err := provider.QueryOrder(callCtx, o.TenantId, o.OutTradeNo)
	if err != nil {
		// Provider is down / credentials rotated / rate-limited — leave the
		// order pending and try again next sweep. Persist the cause into
		// last_error so operators can see why an order is stuck.
		cause := fmt.Sprintf("reconcile query failed: %s", err.Error())
		markOrderLastError(o.OutTradeNo, cause)
		return reconcileOutcomeError
	}
	if result == nil {
		return reconcileOutcomeSkipped
	}

	state := strings.ToUpper(strings.TrimSpace(result.TradeState))
	switch state {
	case "SUCCESS":
		paidAt := result.PaidAt
		if paidAt == 0 {
			paidAt = time.Now().Unix()
		}
		if err := ApplyPaymentSuccess(ctx, o.OutTradeNo, result.TransactionId, paidAt); err != nil {
			common.SysError(fmt.Sprintf("reconcile apply success failed out_trade_no=%s: %s",
				o.OutTradeNo, err.Error()))
			return reconcileOutcomeError
		}
		return reconcileOutcomePaid

	case "CLOSED", "PAYERROR", "REVOKED":
		if flipped, err := model.MarkOrderClosed(o.OutTradeNo, "reconcile: "+state); err != nil {
			common.SysError(fmt.Sprintf("reconcile mark closed failed out_trade_no=%s: %s",
				o.OutTradeNo, err.Error()))
			return reconcileOutcomeError
		} else if !flipped {
			return reconcileOutcomeSkipped
		}
		return reconcileOutcomeClosed

	case "NOTPAY", "USERPAYING", "ACCEPT":
		// WeChat still thinks this can be paid. If our local ExpiresAt has
		// passed, close it locally to stop scanning. Otherwise leave it for
		// the next sweep.
		if o.ExpiresAt > 0 && time.Now().Unix() >= o.ExpiresAt {
			if flipped, err := model.MarkOrderExpired(o.OutTradeNo, "reconcile: past expires_at ("+state+")"); err != nil {
				common.SysError(fmt.Sprintf("reconcile mark expired failed out_trade_no=%s: %s",
					o.OutTradeNo, err.Error()))
				return reconcileOutcomeError
			} else if !flipped {
				return reconcileOutcomeSkipped
			}
			return reconcileOutcomeExpired
		}
		return reconcileOutcomeSkipped

	case "REFUND":
		// The refund path owns this transition (S3 refund flow). Nothing for
		// the payment reconcile loop to do beyond leaving a breadcrumb.
		markOrderLastError(o.OutTradeNo, "reconcile: refund in progress")
		return reconcileOutcomeSkipped

	default:
		// Unknown state from provider. Keep pending and log for triage.
		markOrderLastError(o.OutTradeNo, "reconcile: unknown state "+state)
		common.SysLog(fmt.Sprintf("payment reconcile unknown state out_trade_no=%s state=%s",
			o.OutTradeNo, state))
		return reconcileOutcomeSkipped
	}
}

// markOrderLastError writes a stamp into last_error without changing status.
// Reuses the same helper that CreateOrder uses on upstream failure so
// operator tools read one column to understand why an order is stuck.
func markOrderLastError(outTradeNo string, cause string) {
	markOrderCreationError(outTradeNo, cause)
}
