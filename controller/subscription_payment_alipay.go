package controller

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
)

type SubscriptionAlipayPayRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestAlipay(c *gin.Context) {
	var req SubscriptionAlipayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	tradeNo := fmt.Sprintf("%s%d", common.GetRandomString(6), time.Now().Unix())
	tradeNo = fmt.Sprintf("SUBUSR%dNO%s", userId, tradeNo)

	client, err := GetAlipayClient()
	if err != nil || client == nil {
		common.ApiErrorMsg(c, "支付宝配置错误")
		return
	}

	order := &model.SubscriptionOrder{
		UserId:        userId,
		PlanId:        plan.Id,
		Money:         plan.PriceAmount,
		TradeNo:       tradeNo,
		PaymentMethod: "alipay",
		CreateTime:    time.Now().Unix(),
		Status:        common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}

	notifyURL := system_setting.ServerAddress + "/api/subscription/alipay/notify"
	returnURL := system_setting.ServerAddress + "/api/subscription/alipay/return"

	var p = alipay.TradePagePay{}
	p.NotifyURL = notifyURL
	p.ReturnURL = returnURL
	p.Subject = fmt.Sprintf("订阅:%s", plan.Title)
	p.OutTradeNo = tradeNo
	p.TotalAmount = fmt.Sprintf("%.2f", plan.PriceAmount)
	p.ProductCode = "FAST_INSTANT_TRADE_PAY"

	url, err := client.TradePagePay(p)
	if err != nil {
		_ = model.ExpireSubscriptionOrder(tradeNo)
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"pay_url": url.String()}})
}

func SubscriptionAlipayNotify(c *gin.Context) {
	client, err := GetAlipayClient()
	if err != nil || client == nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_ = c.Request.ParseForm()
	notification, err := client.DecodeNotification(c.Request.Form)
	if err != nil {
		log.Println("订阅支付宝回调验签失败:", err)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	if notification.TradeStatus != "TRADE_SUCCESS" && notification.TradeStatus != "TRADE_FINISHED" {
		_, _ = c.Writer.Write([]byte("success"))
		return
	}

	LockOrder(notification.OutTradeNo)
	defer UnlockOrder(notification.OutTradeNo)

	payload := fmt.Sprintf(`{"trade_no":"%s","buyer_id":"%s"}`, notification.TradeNo, notification.BuyerId)
	if err := model.CompleteSubscriptionOrder(notification.OutTradeNo, payload); err != nil {
		log.Printf("订阅支付宝回调处理失败: %v", err)
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_, _ = c.Writer.Write([]byte("success"))
}

func SubscriptionAlipayReturn(c *gin.Context) {
	client, err := GetAlipayClient()
	if err != nil || client == nil {
		c.Redirect(http.StatusFound, system_setting.ServerAddress+"/console/topup?pay=fail")
		return
	}

	notification, err := client.DecodeNotification(c.Request.URL.Query())
	if err != nil {
		// Return URL 通常不携带完整的通知参数，直接跳转
		c.Redirect(http.StatusFound, system_setting.ServerAddress+"/console/topup?pay=pending")
		return
	}

	if notification.TradeStatus == "TRADE_SUCCESS" || notification.TradeStatus == "TRADE_FINISHED" {
		LockOrder(notification.OutTradeNo)
		defer UnlockOrder(notification.OutTradeNo)
		payload := fmt.Sprintf(`{"trade_no":"%s","buyer_id":"%s"}`, notification.TradeNo, notification.BuyerId)
		if err := model.CompleteSubscriptionOrder(notification.OutTradeNo, payload); err != nil {
			c.Redirect(http.StatusFound, system_setting.ServerAddress+"/console/topup?pay=fail")
			return
		}
		c.Redirect(http.StatusFound, system_setting.ServerAddress+"/console/topup?pay=success")
		return
	}

	c.Redirect(http.StatusFound, system_setting.ServerAddress+"/console/topup?pay=pending")
}
