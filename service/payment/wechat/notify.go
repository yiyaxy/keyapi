package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
)

// verifyAndParseNotify runs wechatpay-go's Notify handler which:
//  1. Verifies the SHA256-with-RSA signature using the platform cert
//     (downloaded and cached by the tenant's core.Client via
//     WithWechatPayAutoAuthCipher, which registers the tenant with
//     downloader.MgrInstance() automatically).
//  2. AES-256-GCM decrypts the encrypted resource body using apiv3_key.
//  3. Unmarshals the plaintext into transactionPayload, then maps to
//     payment.NotifyResult.
//
// headers must be the raw HTTP headers from the Gin request
// (pass c.Request.Header cast to map[string]string, or the adapter below).
// body must be the raw request body bytes (read with io.ReadAll before
// Gin's binding drains it).
func verifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	// Ensure the cached client exists (and thus the downloader is registered).
	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, fmt.Errorf("load client for notify: %w", err)
	}

	// Guard: confirm downloader is registered for this mchid before we ask
	// the Mgr for a cert visitor. GetCertificateVisitor always returns a
	// non-nil wrapper, but it would silently fail cert lookup if the downloader
	// was never registered.
	if !downloader.MgrInstance().HasDownloader(ctx, cc.mchid) {
		return nil, errors.New("platform cert downloader not registered for tenant")
	}
	certVisitor := downloader.MgrInstance().GetCertificateVisitor(cc.mchid)

	apiv3Key, err := getApiv3Key(tenantId)
	if err != nil {
		return nil, err
	}

	h := notify.NewNotifyHandler(apiv3Key, verifiers.NewSHA256WithRSAVerifier(certVisitor))

	var txn transactionPayload
	req := buildHttpRequest(headers, body)
	if _, err = h.ParseNotifyRequest(ctx, req, &txn); err != nil {
		return nil, fmt.Errorf("parse notify: %w", err)
	}

	paidUnix := int64(0)
	if txn.SuccessTime != "" {
		paidUnix = parseRFC3339Unix(txn.SuccessTime)
	}
	return &payment.NotifyResult{
		OutTradeNo:    txn.OutTradeNo,
		TransactionId: txn.TransactionId,
		PaidAt:        paidUnix,
		Success:       txn.TradeState == "SUCCESS",
		RawState:      txn.TradeState,
	}, nil
}

// transactionPayload mirrors the fields we need from the notify resource body
// (subset of WeChat's Transaction struct; wechatpay-go decrypts into this via
// encoding/json, so only json tags matter).
type transactionPayload struct {
	OutTradeNo    string `json:"out_trade_no"`
	TransactionId string `json:"transaction_id"`
	TradeState    string `json:"trade_state"`
	SuccessTime   string `json:"success_time"` // RFC3339 / ISO 8601
}

// getApiv3Key reads the tenant config (with bypass) and decrypts only the
// apiv3_key field. Isolated so the notify path can run without re-decrypting
// the full sensitive bundle.
func getApiv3Key(tenantId int) (string, error) {
	cfg, err := loadConfigForNotify(tenantId)
	if err != nil {
		return "", err
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return "", fmt.Errorf("decrypt apiv3_key: %w", err)
	}
	if plain.Apiv3Key == "" {
		return "", errors.New("apiv3_key empty for tenant")
	}
	return plain.Apiv3Key, nil
}
