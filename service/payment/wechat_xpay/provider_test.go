package wechat_xpay

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupXpayTestDB(t *testing.T) func() {
	t.Helper()
	prevDB := model.DB
	prevRedis := common.RedisEnabled
	model.InitColForTest()
	common.RedisEnabled = false
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	model.DB = db
	if err := db.AutoMigrate(&model.TenantPaymentConfig{}, &model.TenantXpayProduct{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return func() {
		model.DB = prevDB
		common.RedisEnabled = prevRedis
	}
}

func seedXpayConfig(t *testing.T) {
	t.Helper()
	cfg := &model.TenantPaymentConfig{
		TenantId:    7,
		Provider:    "wechat",
		Enabled:     true,
		XpayEnabled: true,
		AppId:       "wx-app",
		XpayOfferId: "offer-1",
		XpayEnv:     "0",
	}
	if err := cfg.EncryptAndSetSensitive(model.TenantPaymentPlaintext{XpayAppKey: "app-key"}); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if err := model.UpsertTenantPaymentConfig(cfg); err != nil {
		t.Fatalf("upsert cfg: %v", err)
	}
	if err := model.WithTenantBypass(model.DB).Create(&model.TenantXpayProduct{
		TenantId:    7,
		TierCode:    "q100",
		Name:        "Quota 100",
		ProductId:   "prod-100",
		Platform:    "android",
		AmountCents: 100,
		QuotaDelta:  1000,
		Enabled:     true,
	}).Error; err != nil {
		t.Fatalf("insert product: %v", err)
	}
}

func TestCreateOrderBuildsVirtualPaymentParams(t *testing.T) {
	defer setupXpayTestDB(t)()
	seedXpayConfig(t)
	service.StoreWxMiniSessionKey(7, "openid-1", "session-key")

	meta, _ := json.Marshal(map[string]any{
		"xpay_tier_code": "q100",
		"xpay_platform":  "android",
	})
	resp, err := (providerImpl{}).CreateOrder(context.Background(), payment.CreateOrderRequest{
		Order: &model.PaymentOrder{
			TenantId:    7,
			ProductForm: model.PaymentProductFormXpayGoods,
			OutTradeNo:  "wx_t7_T_1_abcdef",
			Currency:    "CNY",
			Metadata:    string(meta),
		},
		Openid: "openid-1",
	})
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if resp.Mode != modeGoods || resp.SignData == "" || resp.PaySig == "" || resp.Signature == "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	var sd signData
	if err := json.Unmarshal([]byte(resp.SignData), &sd); err != nil {
		t.Fatalf("signData json: %v", err)
	}
	if sd.OfferId != "offer-1" || sd.Platform != "android" || sd.ProductId != "prod-100" || sd.GoodsPrice != 100 || sd.OutTradeNo != "wx_t7_T_1_abcdef" {
		t.Fatalf("signData = %+v", sd)
	}
	if sd.Attach != "q100|android|0" {
		t.Fatalf("attach = %q", sd.Attach)
	}
}

func TestVerifyAndParseNotifyUsesPayInfo(t *testing.T) {
	defer setupXpayTestDB(t)()
	seedXpayConfig(t)

	payload := `{"OutTradeNo":"wx_t7_T_1_abcdef","PayInfo":{"MchOrderNo":"mch-1","TransactionId":"txn-1","PaidTime":1700000000}}`
	env := notifyEnvelope{
		EventType:   "TRANSACTION.SUCCESS",
		Event:       notifyEvent,
		Payload:     payload,
		PayEventSig: calcHMACHex("app-key", notifyEvent+"&"+payload),
	}
	body, _ := json.Marshal(env)
	result, err := (providerImpl{}).VerifyAndParseNotify(context.Background(), 7, body, nil)
	if err != nil {
		t.Fatalf("VerifyAndParseNotify: %v", err)
	}
	if !result.Success || result.OutTradeNo != "wx_t7_T_1_abcdef" || result.TransactionId != "txn-1" || result.PaidAt != 1700000000 {
		t.Fatalf("result = %+v", result)
	}
}

func TestVerifyAndParseNotifyUsesWeChatPayInfo(t *testing.T) {
	defer setupXpayTestDB(t)()
	seedXpayConfig(t)

	payload := `{"OutTradeNo":"wx_t7_T_1_abcdef","WeChatPayInfo":{"MchOrderNo":"mch-1","TransactionId":"txn-2","PaidTime":1700000010}}`
	env := notifyEnvelope{
		EventType:   "TRANSACTION.SUCCESS",
		Event:       notifyEvent,
		Payload:     payload,
		PayEventSig: calcHMACHex("app-key", notifyEvent+"&"+payload),
	}
	body, _ := json.Marshal(env)
	result, err := (providerImpl{}).VerifyAndParseNotify(context.Background(), 7, body, nil)
	if err != nil {
		t.Fatalf("VerifyAndParseNotify: %v", err)
	}
	if !result.Success || result.TransactionId != "txn-2" || result.PaidAt != 1700000010 {
		t.Fatalf("result = %+v", result)
	}
}
