package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CreateTopupOrderInput is what the topup controller hands in.
// AmountUnits keeps the legacy top_ups.Amount semantics used by invoice /
// history views. QuotaDelta is the authoritative raw quota to credit on
// success and must be computed at order-creation time from the original
// request amount.
type CreateTopupOrderInput struct {
	TenantId    int   // order.TenantId = session tenant (收款归属)
	UserId      int   // order.UserId = payer
	AmountCents int64 // CNY cents (what WeChat charges)
	AmountUnits int64 // top_ups.Amount value; see doc above
	QuotaDelta  int64 // authoritative raw quota to credit on success
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
	if in.QuotaDelta <= 0 {
		return nil, nil, errors.New("invalid topup input: quota_delta required")
	}
	// Metadata keys match the applyTopupSuccess reader exactly.
	meta, _ := json.Marshal(map[string]any{
		"amount_units": in.AmountUnits,
		"quota_delta":  in.QuotaDelta,
	})
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

// readQuotaDeltaFromMetadata prefers the authoritative quota_delta field and
// falls back to the legacy amount_units × QuotaPerUnit contract for old or
// in-flight orders that predate quota_delta.
func readQuotaDeltaFromMetadata(rawMetadata string, quotaPerUnit float64) (int64, error) {
	var meta struct {
		AmountUnits int64 `json:"amount_units"`
		QuotaDelta  int64 `json:"quota_delta"`
	}
	if rawMetadata == "" {
		return 0, fmt.Errorf("empty metadata")
	}
	if err := json.Unmarshal([]byte(rawMetadata), &meta); err != nil {
		return 0, fmt.Errorf("parse topup metadata: %w", err)
	}
	if meta.QuotaDelta > 0 {
		return meta.QuotaDelta, nil
	}
	if meta.AmountUnits <= 0 {
		return 0, fmt.Errorf("neither quota_delta nor amount_units set")
	}
	qpu := decimal.NewFromFloat(quotaPerUnit)
	delta := decimal.NewFromInt(meta.AmountUnits).Mul(qpu).IntPart()
	if delta <= 0 {
		return 0, fmt.Errorf("legacy fallback computed non-positive delta")
	}
	return delta, nil
}

// applyTopupSuccess credits the user's quota, writes a top_ups row and an
// audit log entry inside the caller's tx, then schedules postCommit
// side-effects (topup log, rebate, cache sync) that run only after the tx
// commits. See ApplyPaymentSuccess for the postCommit guarantee.
func applyTopupSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	if order.UserId <= 0 {
		return errors.New("topup order missing UserId")
	}
	// Resolve the quota to credit. New orders stamp metadata.quota_delta as
	// the authoritative value; old or in-flight orders fall back to the
	// legacy amount_units × QuotaPerUnit contract.
	quotaToAdd, err := readQuotaDeltaFromMetadata(order.Metadata, common.QuotaPerUnit)
	if err != nil {
		return fmt.Errorf("resolve quota delta for order %d: %w", order.Id, err)
	}

	// amount_units is still persisted into top_ups.Amount for legacy
	// display/history semantics even though quota_delta is authoritative.
	var meta struct {
		AmountUnits int64 `json:"amount_units"`
	}
	if order.Metadata != "" {
		if err := json.Unmarshal([]byte(order.Metadata), &meta); err != nil {
			return fmt.Errorf("parse topup metadata: %w", err)
		}
	}

	// Add quota to the user's HOME tenant row (users.tenant_id), NOT
	// order.TenantId (which is the session/collection tenant). See spec §6.3
	// and controller/topup.go:374 for the precedent.
	homeTenant := model.GetUserTenantId(order.UserId)
	if homeTenant <= 0 {
		return fmt.Errorf("cannot resolve home tenant for user %d", order.UserId)
	}
	// Tx-local quota credit. Do NOT call model.IncreaseUserQuota here —
	// that helper writes via the global DB (model/user.go:1072) and
	// kicks off an async gopool.Go cache write, both of which commit
	// independently of this tx. If the top_ups insert or audit write
	// below fails, we need users.quota to roll back with them.
	// Cache sync is deferred to postCommit (ran only after tx success).
	res := tx.Exec(
		"UPDATE users SET quota = quota + ? WHERE id = ? AND tenant_id = ?",
		quotaToAdd, order.UserId, homeTenant,
	)
	if res.Error != nil {
		return fmt.Errorf("increase quota: %w", res.Error)
	}
	if res.RowsAffected != 1 {
		return fmt.Errorf("quota update affected %d rows (user=%d, home=%d)",
			res.RowsAffected, order.UserId, homeTenant)
	}

	// Record a top_ups row visible in the SESSION tenant so the user sees
	// this order in their payment history / invoice flows. payment_method
	// = "wxpay" keeps it compatible with invoice_service.go filters.
	// Amount = AmountUnits (the "display units" value, matching epay
	// line 234 semantics); NOT the quota delta. CreateTime = order's
	// creation stamp; CompleteTime = paid moment.
	topup := &model.TopUp{
		TenantId:      order.TenantId,
		UserId:        order.UserId,
		Amount:        meta.AmountUnits,
		RawQuota:      quotaToAdd,
		Money:         float64(order.Amount) / 100.0, // CNY yuan
		TradeNo:       order.OutTradeNo,
		PaymentMethod: "wxpay",
		Status:        "success",
		CreateTime:    order.CreatedAt,
		CompleteTime:  order.PaidAt,
	}
	if err := tx.Create(topup).Error; err != nil {
		return fmt.Errorf("record top_ups: %w", err)
	}

	// Audit — MUST use the tx variant; the plain CreateTenantAuditLog
	// writes via global DB and would persist even on tx rollback.
	if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
		TenantId:    order.TenantId,
		ActorUserId: order.UserId,
		Action:      "payment.topup.success",
		Target:      "payment_orders",
		TargetId:    order.Id,
		Detail: mustJSON(map[string]any{
			"out_trade_no":   order.OutTradeNo,
			"amount_cents":   order.Amount,
			"amount_units":   meta.AmountUnits,
			"quota_delta":    quotaToAdd,
			"home_tenant":    homeTenant,
			"session_tenant": order.TenantId,
		}),
	}); err != nil {
		// Don't fail the payment for an audit write hiccup, but log it.
		common.SysLog(fmt.Sprintf("topup audit tx-write failed: %v", err))
	}

	// Post-commit side-effects. Parity with the existing epay success
	// path (controller/topup.go:380-382) + the Stripe path
	// (model/topup.go:130-133). WeChat must NOT behave differently per
	// channel. Both helpers use global DB internally, so running them
	// inside the tx would either (a) write to a different connection
	// and not be atomic with the tx, or (b) block the tx on another
	// connection's locks — neither is what we want. postCommit is
	// correct.
	userId := order.UserId
	delta := quotaToAdd
	tenantForLog := homeTenant
	money := float64(order.Amount) / 100.0
	logContent := fmt.Sprintf("使用微信支付充值成功，充值金额: %v，支付金额：%.2f 元",
		logger.FormatQuota(int(delta)), money)
	*postCommit = append(*postCommit, func() {
		// 1. Topup log entry — visible in user log UI.
		model.RecordTopUpLogWithTenant(tenantForLog, userId, int(delta), logContent)
		// 2. Rebate processing — matches controller/topup.go:382 behavior.
		model.ProcessTopUpRebate(userId, int(delta))
		// 3. User quota cache sync.
		if err := model.CacheIncrUserQuota(userId, delta); err != nil {
			common.SysLog(fmt.Sprintf("topup cache sync failed user=%d: %v", userId, err))
		}
	})
	return nil
}

// mustJSON marshals v to a JSON string; returns "{}" on error (audit detail
// is best-effort, a marshal failure must not fail the payment tx).
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func applySubSuccess(tx *gorm.DB, order *model.PaymentOrder, postCommit *[]func()) error {
	var meta struct {
		RenewPeriodDays int `json:"renew_period_days"`
	}
	if order.Metadata != "" {
		if err := json.Unmarshal([]byte(order.Metadata), &meta); err != nil {
			return fmt.Errorf("parse sub metadata: %w", err)
		}
	}
	if meta.RenewPeriodDays <= 0 {
		return fmt.Errorf("invalid renew_period_days for sub order %d", order.Id)
	}

	// Read plan inside the tx with a row lock to serialize concurrent
	// renewals. Without this lock two callbacks landing at the same time
	// would both read the same old ExpiresAt and the second UPDATE would
	// overwrite the first — effectively losing one renewal (review #3).
	//
	// NOTE: do NOT use model.GetTenantPlan — it uses the global DB.
	var plan model.TenantPlan
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("tenant_id = ?", order.TenantId).
		First(&plan).Error; err != nil {
		return fmt.Errorf("lock plan: %w", err)
	}
	oldExpires := plan.ExpiresAt
	oldStatus := plan.Status
	statusRecovered := oldStatus != model.TenantPlanStatusActive

	// Atomic-expression UPDATE. Belt-and-braces with FOR UPDATE above:
	//   new_expires = GREATEST(expires_at, now) + days*86400
	// Expressed as CASE so we don't depend on MySQL-only GREATEST.
	now := time.Now().Unix()
	secs := int64(meta.RenewPeriodDays) * 86400
	updates := map[string]interface{}{
		"expires_at": gorm.Expr(
			"CASE WHEN expires_at > ? THEN expires_at + ? ELSE ? + ? END",
			now, secs, now, secs),
		"updated_at": now,
	}
	if statusRecovered {
		updates["status"] = model.TenantPlanStatusActive
	}
	if err := tx.Model(&model.TenantPlan{}).
		Where("id = ? AND tenant_id = ?", plan.Id, plan.TenantId).
		Updates(updates).Error; err != nil {
		return fmt.Errorf("extend plan expiry: %w", err)
	}

	// Read back the post-UPDATE ExpiresAt for the audit diff. Same tx, so
	// the UPDATE is visible even before commit.
	var reloaded model.TenantPlan
	if err := tx.Select("expires_at").Where("id = ?", plan.Id).First(&reloaded).Error; err != nil {
		return fmt.Errorf("reload plan after update: %w", err)
	}
	newExpires := reloaded.ExpiresAt

	// Audit — tx variant so the audit rolls back with the plan UPDATE
	// on any later failure in this closure. See rationale on
	// applyTopupSuccess / CreateTenantAuditLogTx.
	if err := model.CreateTenantAuditLogTx(tx, &model.TenantAuditLog{
		TenantId:    order.TenantId,
		ActorUserId: order.UserId,
		Action:      "payment.sub.renewed",
		Target:      "tenant_plans",
		TargetId:    plan.Id,
		Detail: mustJSON(map[string]any{
			"out_trade_no":     order.OutTradeNo,
			"amount":           order.Amount,
			"renew_days":       meta.RenewPeriodDays,
			"old_expires_at":   oldExpires,
			"new_expires_at":   newExpires,
			"old_status":       oldStatus,
			"status_recovered": statusRecovered,
		}),
	}); err != nil {
		common.SysLog(fmt.Sprintf("sub audit tx-write failed: %v", err))
	}

	// Post-commit: invalidate cached plan so the relay layer picks up
	// the new ExpiresAt/Status immediately. Must run AFTER commit —
	// invalidating mid-tx would race with an in-flight relay reading
	// stale DB and then re-populating the cache with the old values.
	tid := order.TenantId
	*postCommit = append(*postCommit, func() {
		model.InvalidateTenantPlanCache(tid)
	})
	return nil
}
