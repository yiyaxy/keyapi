package controller

import (
	"fmt"
	"log"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/smartwalle/alipay/v3"
)

func GetAlipayClient() (*alipay.Client, error) {
	var client *alipay.Client
	var err error
	client, err = alipay.New(setting.AlipayAppId, setting.AlipayPrivateKey, !setting.AlipaySandbox)
	if err != nil {
		return nil, err
	}
	err = client.LoadAliPayPublicKey(setting.AlipayPublicKey)
	if err != nil {
		return nil, err
	}
	return client, nil
}

func RequestAlipay(c *gin.Context) {
	var req PayRequest
	err := c.ShouldBindJSON(&req)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	if req.Amount < getMinTopup() {
		c.JSON(200, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", getMinTopup())})
		return
	}

	id := c.GetInt("id")
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	payMoney := getPayMoney(req.Amount, group)
	if payMoney < 0.01 {
		c.JSON(200, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}

	tradeNo := fmt.Sprintf("%s%d", common.GetRandomString(6), time.Now().Unix())
	tradeNo = fmt.Sprintf("USR%dNO%s", id, tradeNo)

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		c.JSON(200, gin.H{"message": "error", "data": "支付宝配置错误"})
		return
	}

	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(int64(amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		amount = dAmount.Div(dQuotaPerUnit).IntPart()
	}

	topUp := &model.TopUp{
		UserId:        id,
		Amount:        amount,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: "alipay",
		CreateTime:    time.Now().Unix(),
		Status:        "pending",
	}
	err = topUp.Insert()
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	returnURL := system_setting.ServerAddress + "/console/log"
	notifyURL := system_setting.ServerAddress + "/api/alipay/notify"

	var p = alipay.TradePagePay{}
	p.NotifyURL = notifyURL
	p.ReturnURL = returnURL
	p.Subject = fmt.Sprintf("充值%d", req.Amount)
	p.OutTradeNo = tradeNo
	p.TotalAmount = fmt.Sprintf("%.2f", payMoney)
	p.ProductCode = "FAST_INSTANT_TRADE_PAY"

	url, err := client.TradePagePay(p)
	if err != nil {
		log.Printf("支付宝创建支付失败: %v", err)
		c.JSON(200, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}

	c.JSON(200, gin.H{"message": "success", "data": gin.H{"pay_url": url.String()}})
}

func AlipayNotify(c *gin.Context) {
	client, err := GetAlipayClient()
	if err != nil || client == nil {
		log.Println("支付宝回调失败: 未找到配置信息")
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_ = c.Request.ParseForm()
	notification, err := client.DecodeNotification(c.Request.Form)
	if err != nil {
		log.Println("支付宝回调验签失败:", err)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	if notification.TradeStatus != "TRADE_SUCCESS" && notification.TradeStatus != "TRADE_FINISHED" {
		log.Printf("支付宝回调: 交易状态=%s, 订单号=%s", notification.TradeStatus, notification.OutTradeNo)
		_, _ = c.Writer.Write([]byte("success"))
		return
	}

	LockOrder(notification.OutTradeNo)
	defer UnlockOrder(notification.OutTradeNo)

	topUp := model.GetTopUpByTradeNo(notification.OutTradeNo)
	if topUp == nil {
		log.Printf("支付宝回调未找到订单: %s", notification.OutTradeNo)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	if topUp.Status == "pending" {
		topUp.Status = "success"
		topUp.CompleteTime = common.GetTimestamp()
		err := topUp.Update()
		if err != nil {
			log.Printf("支付宝回调更新订单失败: %v", topUp)
			_, _ = c.Writer.Write([]byte("fail"))
			return
		}
		dAmount := decimal.NewFromInt(int64(topUp.Amount))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd := int(dAmount.Mul(dQuotaPerUnit).IntPart())
		err = model.IncreaseUserQuota(topUp.UserId, quotaToAdd, true)
		if err != nil {
			log.Printf("支付宝回调更新用户额度失败: %v", topUp)
			_, _ = c.Writer.Write([]byte("fail"))
			return
		}
		log.Printf("支付宝回调更新用户成功 %v", topUp)
		model.RecordLog(topUp.UserId, model.LogTypeTopup, fmt.Sprintf("使用支付宝充值成功，充值金额: %v，支付金额：%f", quotaToAdd, topUp.Money))
	}

	_, _ = c.Writer.Write([]byte("success"))
}
