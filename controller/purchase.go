package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// ---- Admin: TopUp order management ----

// AdminListTopUpOrders returns paginated TopUp orders with username via LEFT JOIN.
func AdminListTopUpOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status := c.Query("status")
	orders, total, err := model.GetAllTopUpsWithUser(pageInfo, keyword, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminOrderActionRequest struct {
	TradeNo string `json:"trade_no"`
}

// AdminExpireTopUpOrder marks a pending TopUp order as expired.
func AdminExpireTopUpOrder(c *gin.Context) {
	var req AdminOrderActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "invalid parameters")
		return
	}

	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)

	if err := model.ExpireTopUpOrder(req.TradeNo); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteTopUpOrder hard-deletes a TopUp order.
func AdminDeleteTopUpOrder(c *gin.Context) {
	var req AdminOrderActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "invalid parameters")
		return
	}
	if err := model.DeleteTopUpOrder(req.TradeNo); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: Subscription order management ----

// paidCurrencyFromMethod infers the payment currency from the payment method name.
func paidCurrencyFromMethod(method string) string {
	switch method {
	case "stripe", "creem":
		return "USD"
	default:
		return "CNY"
	}
}

// AdminListSubscriptionOrdersFull returns paginated subscription orders with username via LEFT JOIN.
// Each row is enriched with purchase_amount, purchase_currency, paid_amount, paid_currency.
func AdminListSubscriptionOrdersFull(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status := c.Query("status")
	orders, total, err := model.GetAllSubscriptionOrdersWithUser(pageInfo, keyword, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Collect unique plan IDs and fetch them in one query.
	planIds := make([]int, 0, len(orders))
	for _, o := range orders {
		planIds = append(planIds, o.PlanId)
	}
	planMap, _ := model.GetSubscriptionPlansByIds(planIds) // best-effort; missing plans are handled below

	type enrichedOrder struct {
		model.SubscriptionOrderWithUser
		PurchaseAmount   float64 `json:"purchase_amount"`
		PurchaseCurrency string  `json:"purchase_currency"`
		PaidAmount       float64 `json:"paid_amount"`
		PaidCurrency     string  `json:"paid_currency"`
	}
	enriched := make([]enrichedOrder, 0, len(orders))
	for _, o := range orders {
		e := enrichedOrder{
			SubscriptionOrderWithUser: o,
			PaidAmount:                o.Money,
			PaidCurrency:              paidCurrencyFromMethod(o.PaymentMethod),
		}
		if plan, ok := planMap[o.PlanId]; ok {
			e.PurchaseAmount = plan.PriceAmount
			cur := plan.Currency
			if cur == "" {
				cur = "CNY"
			}
			e.PurchaseCurrency = cur
		}
		enriched = append(enriched, e)
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(enriched)
	common.ApiSuccess(c, pageInfo)
}

// AdminExpireSubscriptionOrderAction marks a pending subscription order as expired.
func AdminExpireSubscriptionOrderAction(c *gin.Context) {
	var req AdminOrderActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "invalid parameters")
		return
	}

	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)

	if err := model.ExpireSubscriptionOrder(req.TradeNo); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteSubscriptionOrderAction hard-deletes a subscription order.
func AdminDeleteSubscriptionOrderAction(c *gin.Context) {
	var req AdminOrderActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "invalid parameters")
		return
	}
	if err := model.DeleteSubscriptionOrder(req.TradeNo); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
