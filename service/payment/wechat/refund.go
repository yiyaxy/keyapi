package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/services/refunddomestic"
)

// createRefund submits a refund via wechatpay-go's Refunds.Create, using
// the tenant's cached core.Client. out_refund_no is the caller-provided
// idempotency key; WeChat rejects a second call with the same id that
// carries a different amount, so the PaymentRefund row MUST exist before
// this is called.
func createRefund(ctx context.Context, tenantId int, req payment.RefundRequest) (*payment.RefundResult, error) {
	if req.Order == nil || req.Refund == nil {
		return nil, errors.New("req.Order/req.Refund nil")
	}
	if req.Refund.Amount <= 0 || req.OriginalAmount <= 0 {
		return nil, errors.New("refund amount / original amount must be > 0")
	}
	if req.Refund.Amount > req.OriginalAmount {
		return nil, fmt.Errorf("refund amount %d exceeds original %d",
			req.Refund.Amount, req.OriginalAmount)
	}

	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, err
	}

	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	svc := refunddomestic.RefundsApiService{Client: cc.client}
	amt := &refunddomestic.AmountReq{
		Refund:   int64Ptr(req.Refund.Amount),
		Total:    int64Ptr(req.OriginalAmount),
		Currency: stringPtr("CNY"),
	}
	createReq := refunddomestic.CreateRequest{
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		OutRefundNo: stringPtr(req.Refund.OutRefundNo),
		Amount:      amt,
	}
	if req.NotifyUrl != "" {
		createReq.NotifyUrl = stringPtr(req.NotifyUrl)
	}
	if req.Reason != "" {
		createReq.Reason = stringPtr(req.Reason)
	}

	resp, _, err := svc.Create(callCtx, createReq)
	if err != nil {
		return nil, fmt.Errorf("wechat refund create: %w", err)
	}
	if resp == nil {
		return nil, errors.New("wechat refund returned empty response")
	}

	out := &payment.RefundResult{}
	if resp.RefundId != nil {
		out.RefundId = *resp.RefundId
	}
	if resp.Status != nil {
		out.RefundStatus = string(*resp.Status)
	}
	if resp.SuccessTime != nil {
		out.SuccessTime = resp.SuccessTime.Unix()
	}
	return out, nil
}

// verifyAndParseRefundNotify decrypts and verifies a refund callback body
// using the same machinery the payment callback path uses. The decrypted
// plaintext shape differs from a payment notify, so we use a dedicated
// payload struct.
func verifyAndParseRefundNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.RefundNotifyResult, error) {
	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, fmt.Errorf("load client for refund notify: %w", err)
	}
	if !downloader.MgrInstance().HasDownloader(ctx, cc.mchid) {
		return nil, errors.New("platform cert downloader not registered for tenant")
	}
	certVisitor := downloader.MgrInstance().GetCertificateVisitor(cc.mchid)

	apiv3Key, err := getApiv3Key(tenantId)
	if err != nil {
		return nil, err
	}

	h := notify.NewNotifyHandler(apiv3Key, verifiers.NewSHA256WithRSAVerifier(certVisitor))

	var payload refundNotifyPayload
	req := buildHttpRequest(headers, body)
	if _, err = h.ParseNotifyRequest(ctx, req, &payload); err != nil {
		return nil, fmt.Errorf("parse refund notify: %w", err)
	}

	successAt := int64(0)
	if payload.SuccessTime != "" {
		successAt = parseRFC3339Unix(payload.SuccessTime)
	}
	return &payment.RefundNotifyResult{
		OutTradeNo:   payload.OutTradeNo,
		OutRefundNo:  payload.OutRefundNo,
		RefundId:     payload.RefundId,
		RefundStatus: payload.RefundStatus,
		SuccessTime:  successAt,
		Amount:       payload.Amount.Refund,
	}, nil
}

// refundNotifyPayload mirrors the fields we need from WeChat's refund
// callback body (subset of the full RefundNotify struct).
type refundNotifyPayload struct {
	OutTradeNo   string `json:"out_trade_no"`
	TransactionId string `json:"transaction_id"`
	OutRefundNo  string `json:"out_refund_no"`
	RefundId     string `json:"refund_id"`
	RefundStatus string `json:"refund_status"` // SUCCESS | CLOSED | PROCESSING | ABNORMAL
	SuccessTime  string `json:"success_time"`
	Amount       struct {
		Refund int64 `json:"refund"`
		Total  int64 `json:"total"`
	} `json:"amount"`
}

