package model

import (
	"fmt"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// --- DTOs ---

type PurchaseOverview struct {
	TotalRevenue    float64 `json:"total_revenue"`
	OrderCount      int64   `json:"order_count"`
	AvgOrderValue   float64 `json:"avg_order_value"`
	PrevRevenue     float64 `json:"prev_revenue"`
	PrevOrderCount  int64   `json:"prev_order_count"`
	RevenueChange   float64 `json:"revenue_change"`   // percentage
	OrderCountChange float64 `json:"order_count_change"` // percentage
}

type PurchaseTrendItem struct {
	TimeBucket string  `json:"time_bucket" gorm:"column:time_bucket"`
	Revenue    float64 `json:"revenue" gorm:"column:revenue"`
	Count      int64   `json:"count" gorm:"column:count"`
}

type PaymentMethodItem struct {
	PaymentMethod string  `json:"payment_method" gorm:"column:payment_method"`
	Revenue       float64 `json:"revenue" gorm:"column:revenue"`
	Count         int64   `json:"count" gorm:"column:count"`
}

type OrderTypeItem struct {
	OrderType string  `json:"order_type" gorm:"column:order_type"`
	Revenue   float64 `json:"revenue" gorm:"column:revenue"`
	Count     int64   `json:"count" gorm:"column:count"`
}

type TopSpenderItem struct {
	UserId   int     `json:"user_id" gorm:"column:user_id"`
	Username string  `json:"username" gorm:"column:username"`
	Revenue  float64 `json:"revenue" gorm:"column:revenue"`
	Count    int64   `json:"count" gorm:"column:count"`
}

type RedemptionStatsResult struct {
	TotalCreated  int64   `json:"total_created"`
	TotalUsed     int64   `json:"total_used"`
	TotalEnabled  int64   `json:"total_enabled"`
	TotalDisabled int64   `json:"total_disabled"`
	TotalQuota    int64   `json:"total_quota"`
	UsageRate     float64 `json:"usage_rate"` // percentage
}

type SubscriptionAnalyticsOverview struct {
	TotalRevenue       float64 `json:"total_revenue"`
	UsedMoney          float64 `json:"used_money"`
	ExpiredUnusedMoney float64 `json:"expired_unused_money"`
	OrderCount         int64   `json:"order_count"`
}

type SubscriptionPlanBreakdownItem struct {
	PlanId        int     `json:"plan_id"`
	PlanName      string  `json:"plan_name"`
	PurchaseCount int64   `json:"purchase_count"`
	TotalRevenue  float64 `json:"total_revenue"`
	UsedQuota     int64   `json:"used_quota"`
	UnusedQuota   int64   `json:"unused_quota"`
	ExpiredUnused int64   `json:"expired_unused"`
}

type TopUpAnalyticsOverview struct {
	TotalRevenue       float64 `json:"total_revenue"`
	WalletBalanceTotal float64 `json:"wallet_balance_total"`
	OrderCount         int64   `json:"order_count"`
}

type DAUTrendItem struct {
	TimeBucket       string `json:"time_bucket" gorm:"column:time_bucket"`
	APIActiveUsers   int64  `json:"api_active_users"`
	LoginActiveUsers int64  `json:"login_active_users"`
	TotalActiveUsers int64  `json:"total_active_users"`
}

type RegistrationTrendItem struct {
	TimeBucket     string `json:"time_bucket" gorm:"column:time_bucket"`
	NewUsers       int64  `json:"new_users"`
	ReferredUsers  int64  `json:"referred_users"`
}

type ConversionFunnelResult struct {
	TotalUsers      int64   `json:"total_users"`
	PayingUsers     int64   `json:"paying_users"`
	RepeatBuyers    int64   `json:"repeat_buyers"`
	ConversionRate  float64 `json:"conversion_rate"`
	RepeatRate      float64 `json:"repeat_rate"`
}

type ReferralAnalyticsItem struct {
	UserId          int     `json:"user_id" gorm:"column:user_id"`
	Inviter         string  `json:"inviter" gorm:"column:inviter"`
	ReferredCount   int64   `json:"referred_count" gorm:"column:referred_count"`
	ReferredRevenue float64 `json:"referred_revenue" gorm:"column:referred_revenue"`
}

// --- Helper: percentage change ---

func pctChange(current, previous float64) float64 {
	if previous == 0 {
		if current == 0 {
			return 0
		}
		return 100
	}
	return (current - previous) / previous * 100
}

// --- Query Functions ---

// GetPurchaseOverview returns revenue summary with period-over-period comparison.
// The previous period mirrors the same duration before startTime.
func GetPurchaseOverview(tenantId int, startTime, endTime int64, orderType string) (*PurchaseOverview, error) {
	type revenueRow struct {
		Revenue float64 `gorm:"column:revenue"`
		Count   int64   `gorm:"column:count"`
	}

	// Current period: top_ups (exclude subscription-related)
	var topupCur revenueRow
	if orderType != "subscription" {
		topupQuery := DB.Table("top_ups").
			Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
		if tenantId > 0 {
			topupQuery = topupQuery.Where("top_ups.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			topupQuery = topupQuery.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			topupQuery = topupQuery.Where("complete_time <= ?", endTime)
		}
		if err := topupQuery.Scan(&topupCur).Error; err != nil {
			return nil, err
		}
	}

	// Current period: subscription_orders
	var subCur revenueRow
	if orderType != "topup" {
		subQuery := DB.Table("subscription_orders").
			Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess)
		if tenantId > 0 {
			subQuery = subQuery.Where("subscription_orders.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			subQuery = subQuery.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			subQuery = subQuery.Where("complete_time <= ?", endTime)
		}
		if err := subQuery.Scan(&subCur).Error; err != nil {
			return nil, err
		}
	}

	curRevenue := topupCur.Revenue + subCur.Revenue
	curCount := topupCur.Count + subCur.Count
	avgOrder := float64(0)
	if curCount > 0 {
		avgOrder = curRevenue / float64(curCount)
	}

	result := &PurchaseOverview{
		TotalRevenue:  curRevenue,
		OrderCount:    curCount,
		AvgOrderValue: avgOrder,
	}

	// Previous period (mirror interval)
	if startTime > 0 && endTime > 0 {
		duration := endTime - startTime
		prevStart := startTime - duration
		prevEnd := startTime

		var topupPrev revenueRow
		if orderType != "subscription" {
			topupPrevQ := DB.Table("top_ups").
				Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
				Where("status = ?", common.TopUpStatusSuccess).
				Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'").
				Where("complete_time >= ? AND complete_time <= ?", prevStart, prevEnd)
			if tenantId > 0 {
				topupPrevQ = topupPrevQ.Where("top_ups.tenant_id = ?", tenantId)
			}
			if err := topupPrevQ.Scan(&topupPrev).Error; err != nil {
				return nil, err
			}
		}

		var subPrev revenueRow
		if orderType != "topup" {
			subPrevQ := DB.Table("subscription_orders").
				Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
				Where("status = ?", common.TopUpStatusSuccess).
				Where("complete_time >= ? AND complete_time <= ?", prevStart, prevEnd)
			if tenantId > 0 {
				subPrevQ = subPrevQ.Where("subscription_orders.tenant_id = ?", tenantId)
			}
			if err := subPrevQ.Scan(&subPrev).Error; err != nil {
				return nil, err
			}
		}

		prevRevenue := topupPrev.Revenue + subPrev.Revenue
		prevCount := topupPrev.Count + subPrev.Count
		result.PrevRevenue = prevRevenue
		result.PrevOrderCount = prevCount
		result.RevenueChange = pctChange(curRevenue, prevRevenue)
		result.OrderCountChange = pctChange(float64(curCount), float64(prevCount))
	}

	return result, nil
}

func dateTruncExpr(column string, granularity string) string {
	offsetSeconds := common.AnalyticsTZOffset * 3600
	adjustedCol := column
	if offsetSeconds != 0 {
		adjustedCol = fmt.Sprintf("(%s + %d)", column, offsetSeconds)
	}

	if common.UsingSQLite {
		switch granularity {
		case "hour":
			return fmt.Sprintf("strftime('%%Y-%%m-%%d %%H:00', datetime(%s, 'unixepoch'))", adjustedCol)
		case "day":
			return fmt.Sprintf("strftime('%%Y-%%m-%%d', datetime(%s, 'unixepoch'))", adjustedCol)
		case "week":
			return fmt.Sprintf("strftime('%%Y-%%W', datetime(%s, 'unixepoch'))", adjustedCol)
		case "month":
			return fmt.Sprintf("strftime('%%Y-%%m', datetime(%s, 'unixepoch'))", adjustedCol)
		default:
			return fmt.Sprintf("strftime('%%Y-%%m-%%d', datetime(%s, 'unixepoch'))", adjustedCol)
		}
	}
	if common.UsingPostgreSQL {
		switch granularity {
		case "hour":
			return fmt.Sprintf("to_char(to_timestamp(%s), 'YYYY-MM-DD HH24:00')", adjustedCol)
		case "day":
			return fmt.Sprintf("to_char(to_timestamp(%s), 'YYYY-MM-DD')", adjustedCol)
		case "week":
			return fmt.Sprintf("to_char(to_timestamp(%s), 'IYYY-IW')", adjustedCol)
		case "month":
			return fmt.Sprintf("to_char(to_timestamp(%s), 'YYYY-MM')", adjustedCol)
		default:
			return fmt.Sprintf("to_char(to_timestamp(%s), 'YYYY-MM-DD')", adjustedCol)
		}
	}
	// MySQL
	switch granularity {
	case "hour":
		return fmt.Sprintf("DATE_FORMAT(FROM_UNIXTIME(%s), '%%Y-%%m-%%d %%H:00')", adjustedCol)
	case "day":
		return fmt.Sprintf("DATE_FORMAT(FROM_UNIXTIME(%s), '%%Y-%%m-%%d')", adjustedCol)
	case "week":
		return fmt.Sprintf("DATE_FORMAT(FROM_UNIXTIME(%s), '%%x-%%v')", adjustedCol)
	case "month":
		return fmt.Sprintf("DATE_FORMAT(FROM_UNIXTIME(%s), '%%Y-%%m')", adjustedCol)
	default:
		return fmt.Sprintf("DATE_FORMAT(FROM_UNIXTIME(%s), '%%Y-%%m-%%d')", adjustedCol)
	}
}

// GetPurchaseTrend returns time-bucketed revenue and count from both tables.
func GetPurchaseTrend(tenantId int, startTime, endTime int64, granularity, orderType string) ([]PurchaseTrendItem, error) {
	bucketExpr := dateTruncExpr("complete_time", granularity)

	// Topup query
	var topupItems []PurchaseTrendItem
	if orderType != "subscription" {
		topupSQL := DB.Table("top_ups").
			Select(bucketExpr+" as time_bucket, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
		if tenantId > 0 {
			topupSQL = topupSQL.Where("top_ups.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			topupSQL = topupSQL.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			topupSQL = topupSQL.Where("complete_time <= ?", endTime)
		}
		topupSQL = topupSQL.Group(bucketExpr)

		if err := topupSQL.Scan(&topupItems).Error; err != nil {
			return nil, err
		}
	}

	// Subscription query
	var subItems []PurchaseTrendItem
	if orderType != "topup" {
		subSQL := DB.Table("subscription_orders").
			Select(bucketExpr+" as time_bucket, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess)
		if tenantId > 0 {
			subSQL = subSQL.Where("subscription_orders.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			subSQL = subSQL.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			subSQL = subSQL.Where("complete_time <= ?", endTime)
		}
		subSQL = subSQL.Group(bucketExpr)

		if err := subSQL.Scan(&subItems).Error; err != nil {
			return nil, err
		}
	}

	// Merge by time_bucket
	merged := make(map[string]*PurchaseTrendItem)
	for _, item := range topupItems {
		m := &PurchaseTrendItem{TimeBucket: item.TimeBucket, Revenue: item.Revenue, Count: item.Count}
		merged[item.TimeBucket] = m
	}
	for _, item := range subItems {
		if existing, ok := merged[item.TimeBucket]; ok {
			existing.Revenue += item.Revenue
			existing.Count += item.Count
		} else {
			m := &PurchaseTrendItem{TimeBucket: item.TimeBucket, Revenue: item.Revenue, Count: item.Count}
			merged[item.TimeBucket] = m
		}
	}

	// Convert to sorted slice
	result := make([]PurchaseTrendItem, 0, len(merged))
	for _, v := range merged {
		result = append(result, *v)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TimeBucket < result[j].TimeBucket
	})

	return result, nil
}

// GetPaymentMethodDistribution returns revenue/count grouped by payment method.
func GetPaymentMethodDistribution(tenantId int, startTime, endTime int64, orderType string) ([]PaymentMethodItem, error) {
	// Top-ups
	var topupItems []PaymentMethodItem
	if orderType != "subscription" {
		topupQ := DB.Table("top_ups").
			Select("payment_method, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
		if tenantId > 0 {
			topupQ = topupQ.Where("top_ups.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			topupQ = topupQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			topupQ = topupQ.Where("complete_time <= ?", endTime)
		}
		topupQ = topupQ.Group("payment_method")

		if err := topupQ.Scan(&topupItems).Error; err != nil {
			return nil, err
		}
	}

	// Subscription orders
	var subItems []PaymentMethodItem
	if orderType != "topup" {
		subQ := DB.Table("subscription_orders").
			Select("payment_method, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess)
		if tenantId > 0 {
			subQ = subQ.Where("subscription_orders.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			subQ = subQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			subQ = subQ.Where("complete_time <= ?", endTime)
		}
		subQ = subQ.Group("payment_method")

		if err := subQ.Scan(&subItems).Error; err != nil {
			return nil, err
		}
	}

	// Merge
	merged := make(map[string]*PaymentMethodItem)
	for _, item := range topupItems {
		m := &PaymentMethodItem{PaymentMethod: item.PaymentMethod, Revenue: item.Revenue, Count: item.Count}
		merged[item.PaymentMethod] = m
	}
	for _, item := range subItems {
		if existing, ok := merged[item.PaymentMethod]; ok {
			existing.Revenue += item.Revenue
			existing.Count += item.Count
		} else {
			m := &PaymentMethodItem{PaymentMethod: item.PaymentMethod, Revenue: item.Revenue, Count: item.Count}
			merged[item.PaymentMethod] = m
		}
	}

	result := make([]PaymentMethodItem, 0, len(merged))
	for _, v := range merged {
		result = append(result, *v)
	}
	return result, nil
}

// GetOrderTypeDistribution returns revenue/count split by order type (topup + subscription plans).
func GetOrderTypeDistribution(tenantId int, startTime, endTime int64) ([]OrderTypeItem, error) {
	result := []OrderTypeItem{}

	// Top-ups
	var topupRow struct {
		Revenue float64 `gorm:"column:revenue"`
		Count   int64   `gorm:"column:count"`
	}
	topupQ := DB.Table("top_ups").
		Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
	if tenantId > 0 {
		topupQ = topupQ.Where("top_ups.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		topupQ = topupQ.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		topupQ = topupQ.Where("complete_time <= ?", endTime)
	}
	if err := topupQ.Scan(&topupRow).Error; err != nil {
		return nil, err
	}
	result = append(result, OrderTypeItem{OrderType: "topup", Revenue: topupRow.Revenue, Count: topupRow.Count})

	// Subscription orders grouped by plan
	type subPlanRow struct {
		PlanTitle string  `gorm:"column:plan_title"`
		Revenue   float64 `gorm:"column:revenue"`
		Count     int64   `gorm:"column:count"`
	}
	var subRows []subPlanRow
	subQ := DB.Table("subscription_orders so").
		Select("COALESCE(sp.title, 'Unknown Plan') as plan_title, COALESCE(SUM(so.money), 0) as revenue, COUNT(*) as count").
		Joins("LEFT JOIN subscription_plans sp ON so.plan_id = sp.id").
		Where("so.status = ?", common.TopUpStatusSuccess)
	if tenantId > 0 {
		subQ = subQ.Where("so.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		subQ = subQ.Where("so.complete_time >= ?", startTime)
	}
	if endTime > 0 {
		subQ = subQ.Where("so.complete_time <= ?", endTime)
	}
	subQ = subQ.Group("sp.title")
	if err := subQ.Scan(&subRows).Error; err != nil {
		return nil, err
	}

	for _, row := range subRows {
		result = append(result, OrderTypeItem{OrderType: row.PlanTitle, Revenue: row.Revenue, Count: row.Count})
	}

	return result, nil
}

// GetTopSpenders returns paged users by total revenue across both tables.
func GetTopSpenders(tenantId int, startTime, endTime int64, offset, pageSize int, orderType string) ([]TopSpenderItem, int64, error) {
	if offset < 0 {
		offset = 0
	}
	if pageSize <= 0 {
		pageSize = 10
	}

	// Top-ups by user
	type userRevRow struct {
		UserId  int     `gorm:"column:user_id"`
		Revenue float64 `gorm:"column:revenue"`
		Count   int64   `gorm:"column:count"`
	}
	var topupRows []userRevRow
	if orderType != "subscription" {
		topupQ := DB.Table("top_ups").
			Select("user_id, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
		if tenantId > 0 {
			topupQ = topupQ.Where("top_ups.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			topupQ = topupQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			topupQ = topupQ.Where("complete_time <= ?", endTime)
		}
		topupQ = topupQ.Group("user_id")

		if err := topupQ.Scan(&topupRows).Error; err != nil {
			return nil, 0, err
		}
	}

	// Subscription orders by user
	var subRows []userRevRow
	if orderType != "topup" {
		subQ := DB.Table("subscription_orders").
			Select("user_id, COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
			Where("status = ?", common.TopUpStatusSuccess)
		if tenantId > 0 {
			subQ = subQ.Where("subscription_orders.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			subQ = subQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			subQ = subQ.Where("complete_time <= ?", endTime)
		}
		subQ = subQ.Group("user_id")

		if err := subQ.Scan(&subRows).Error; err != nil {
			return nil, 0, err
		}
	}

	// Merge by user_id
	merged := make(map[int]*TopSpenderItem)
	for _, r := range topupRows {
		merged[r.UserId] = &TopSpenderItem{UserId: r.UserId, Revenue: r.Revenue, Count: r.Count}
	}
	for _, r := range subRows {
		if existing, ok := merged[r.UserId]; ok {
			existing.Revenue += r.Revenue
			existing.Count += r.Count
		} else {
			merged[r.UserId] = &TopSpenderItem{UserId: r.UserId, Revenue: r.Revenue, Count: r.Count}
		}
	}

	items := make([]TopSpenderItem, 0, len(merged))
	for _, v := range merged {
		items = append(items, *v)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Revenue != items[j].Revenue {
			return items[i].Revenue > items[j].Revenue
		}
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		return items[i].UserId < items[j].UserId
	})

	total := int64(len(items))
	if offset >= len(items) {
		return []TopSpenderItem{}, total, nil
	}
	end := offset + pageSize
	if end > len(items) {
		end = len(items)
	}
	items = items[offset:end]

	// Batch fetch usernames for current page only
	userIds := make([]int, 0, len(items))
	for _, item := range items {
		if item.UserId > 0 {
			userIds = append(userIds, item.UserId)
		}
	}
	userNameMap := make(map[int]string)
	if len(userIds) > 0 {
		var users []struct {
			Id       int    `gorm:"column:id"`
			Username string `gorm:"column:username"`
		}
		usersQ := DB.Table("users").Select("id, username").Where("id IN ?", userIds)
		if tenantId > 0 {
			usersQ = usersQ.Where("users.tenant_id = ?", tenantId)
		}
		usersQ.Find(&users)
		for _, u := range users {
			userNameMap[u.Id] = u.Username
		}
	}
	for i := range items {
		if name, ok := userNameMap[items[i].UserId]; ok {
			items[i].Username = name
		} else {
			items[i].Username = fmt.Sprintf("user#%d", items[i].UserId)
		}
	}

	return items, total, nil
}

// GetSubscriptionAnalyticsOverview returns subscription revenue overview and quota utilisation.
func GetSubscriptionAnalyticsOverview(tenantId int, startTime, endTime int64) (*SubscriptionAnalyticsOverview, error) {
	type revenueRow struct {
		Revenue float64 `gorm:"column:revenue"`
		Count   int64   `gorm:"column:count"`
	}

	var row revenueRow
	q := DB.Table("subscription_orders").
		Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
		Where("status = ?", common.TopUpStatusSuccess)
	if tenantId > 0 {
		q = q.Where("subscription_orders.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		q = q.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		q = q.Where("complete_time <= ?", endTime)
	}
	if err := q.Scan(&row).Error; err != nil {
		return nil, err
	}

	type subRow struct {
		AmountTotal int64   `gorm:"column:amount_total"`
		AmountUsed  int64   `gorm:"column:amount_used"`
		Status      string  `gorm:"column:status"`
		PriceAmount float64 `gorm:"column:price_amount"`
	}
	var subs []subRow
	subQ := DB.Table("user_subscriptions us").
		Select("us.amount_total, us.amount_used, us.status, sp.price_amount").
		Joins("JOIN subscription_plans sp ON us.plan_id = sp.id").
		Where("us.amount_total > 0")
	if tenantId > 0 {
		subQ = subQ.Where("us.tenant_id = ?", tenantId)
	}
	if err := subQ.Scan(&subs).Error; err != nil {
		return nil, err
	}

	var usedMoney float64
	var expiredUnusedMoney float64
	for _, s := range subs {
		if s.AmountTotal > 0 {
			usedMoney += (float64(s.AmountUsed) / float64(s.AmountTotal)) * s.PriceAmount
			if s.Status == "expired" {
				expiredUnusedMoney += (float64(s.AmountTotal-s.AmountUsed) / float64(s.AmountTotal)) * s.PriceAmount
			}
		}
	}

	return &SubscriptionAnalyticsOverview{
		TotalRevenue:       row.Revenue,
		UsedMoney:          usedMoney,
		ExpiredUnusedMoney: expiredUnusedMoney,
		OrderCount:         row.Count,
	}, nil
}

// GetSubscriptionPlanBreakdown returns per-plan revenue and quota stats.
func GetSubscriptionPlanBreakdown(tenantId int, startTime, endTime int64) ([]SubscriptionPlanBreakdownItem, error) {
	type orderRow struct {
		PlanId        int     `gorm:"column:plan_id"`
		PlanName      string  `gorm:"column:plan_name"`
		PurchaseCount int64   `gorm:"column:purchase_count"`
		TotalRevenue  float64 `gorm:"column:total_revenue"`
	}
	var orderRows []orderRow
	q := DB.Table("subscription_orders so").
		Select("so.plan_id, COALESCE(sp.title, 'Unknown Plan') as plan_name, COUNT(*) as purchase_count, COALESCE(SUM(so.money), 0) as total_revenue").
		Joins("JOIN subscription_plans sp ON so.plan_id = sp.id").
		Where("so.status = ?", common.TopUpStatusSuccess)
	if tenantId > 0 {
		q = q.Where("so.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		q = q.Where("so.complete_time >= ?", startTime)
	}
	if endTime > 0 {
		q = q.Where("so.complete_time <= ?", endTime)
	}
	q = q.Group("so.plan_id, sp.title")
	if err := q.Scan(&orderRows).Error; err != nil {
		return nil, err
	}

	type subUsageRow struct {
		PlanId      int    `gorm:"column:plan_id"`
		AmountTotal int64  `gorm:"column:amount_total"`
		AmountUsed  int64  `gorm:"column:amount_used"`
		Status      string `gorm:"column:status"`
	}
	var subRows []subUsageRow
	subUsageQ := DB.Table("user_subscriptions us").
		Select("us.plan_id, us.amount_total, us.amount_used, us.status").
		Joins("JOIN subscription_plans sp ON us.plan_id = sp.id").
		Where("us.amount_total > 0")
	if tenantId > 0 {
		subUsageQ = subUsageQ.Where("us.tenant_id = ?", tenantId)
	}
	if err := subUsageQ.Scan(&subRows).Error; err != nil {
		return nil, err
	}

	type quotaAccum struct {
		UsedQuota     int64
		UnusedQuota   int64
		ExpiredUnused int64
	}
	quotaMap := make(map[int]*quotaAccum)
	for _, s := range subRows {
		if _, ok := quotaMap[s.PlanId]; !ok {
			quotaMap[s.PlanId] = &quotaAccum{}
		}
		acc := quotaMap[s.PlanId]
		acc.UsedQuota += s.AmountUsed
		remaining := s.AmountTotal - s.AmountUsed
		if remaining < 0 {
			remaining = 0
		}
		switch s.Status {
		case "active":
			acc.UnusedQuota += remaining
		case "expired":
			acc.ExpiredUnused += remaining
		}
	}

	planMap := make(map[int]*SubscriptionPlanBreakdownItem)
	for _, r := range orderRows {
		planMap[r.PlanId] = &SubscriptionPlanBreakdownItem{
			PlanId:        r.PlanId,
			PlanName:      r.PlanName,
			PurchaseCount: r.PurchaseCount,
			TotalRevenue:  r.TotalRevenue,
		}
	}
	for planId, acc := range quotaMap {
		if item, ok := planMap[planId]; ok {
			item.UsedQuota = acc.UsedQuota
			item.UnusedQuota = acc.UnusedQuota
			item.ExpiredUnused = acc.ExpiredUnused
		} else {
			planMap[planId] = &SubscriptionPlanBreakdownItem{
				PlanId:        planId,
				UsedQuota:     acc.UsedQuota,
				UnusedQuota:   acc.UnusedQuota,
				ExpiredUnused: acc.ExpiredUnused,
			}
		}
	}

	result := make([]SubscriptionPlanBreakdownItem, 0, len(planMap))
	for _, v := range planMap {
		result = append(result, *v)
	}
	return result, nil
}

// GetTopUpAnalyticsOverview returns top-up revenue summary and total active wallet balance.
func GetTopUpAnalyticsOverview(tenantId int, startTime, endTime int64) (*TopUpAnalyticsOverview, error) {
	type revenueRow struct {
		Revenue float64 `gorm:"column:revenue"`
		Count   int64   `gorm:"column:count"`
	}

	var row revenueRow
	q := DB.Table("top_ups").
		Select("COALESCE(SUM(money), 0) as revenue, COUNT(*) as count").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
	if tenantId > 0 {
		q = q.Where("top_ups.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		q = q.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		q = q.Where("complete_time <= ?", endTime)
	}
	if err := q.Scan(&row).Error; err != nil {
		return nil, err
	}

	var totalQuota struct {
		Total int64 `gorm:"column:total"`
	}
	usersQ := DB.Table("users").
		Select("COALESCE(SUM(quota), 0) as total").
		Where("status = 1")
	if tenantId > 0 {
		usersQ = usersQ.Where("users.tenant_id = ?", tenantId)
	}
	if err := usersQ.Scan(&totalQuota).Error; err != nil {
		return nil, err
	}

	walletBalance := float64(totalQuota.Total) / common.QuotaPerUnit

	return &TopUpAnalyticsOverview{
		TotalRevenue:       row.Revenue,
		WalletBalanceTotal: walletBalance,
		OrderCount:         row.Count,
	}, nil
}

// GetRedemptionStats returns aggregate stats about redemption codes.
func GetRedemptionStats(tenantId int) (*RedemptionStatsResult, error) {
	var result RedemptionStatsResult

	// Total created (all redemptions including soft-deleted are not counted; only non-deleted)
	totalQ := DB.Table("redemptions").Where("deleted_at IS NULL")
	if tenantId > 0 {
		totalQ = totalQ.Where("redemptions.tenant_id = ?", tenantId)
	}
	if err := totalQ.Count(&result.TotalCreated).Error; err != nil {
		return nil, err
	}

	// Count by status
	type statusCount struct {
		Status int   `gorm:"column:status"`
		Count  int64 `gorm:"column:count"`
	}
	var statusCounts []statusCount
	statusQ := DB.Table("redemptions").
		Select("status, COUNT(*) as count").
		Where("deleted_at IS NULL")
	if tenantId > 0 {
		statusQ = statusQ.Where("redemptions.tenant_id = ?", tenantId)
	}
	if err := statusQ.Group("status").
		Scan(&statusCounts).Error; err != nil {
		return nil, err
	}
	for _, sc := range statusCounts {
		switch sc.Status {
		case common.RedemptionCodeStatusEnabled:
			result.TotalEnabled = sc.Count
		case common.RedemptionCodeStatusDisabled:
			result.TotalDisabled = sc.Count
		case common.RedemptionCodeStatusUsed:
			result.TotalUsed = sc.Count
		}
	}

	// Total quota distributed (all non-deleted)
	var totalQuota struct {
		Total int64 `gorm:"column:total"`
	}
	quotaQ := DB.Table("redemptions").
		Select("COALESCE(SUM(quota), 0) as total").
		Where("deleted_at IS NULL")
	if tenantId > 0 {
		quotaQ = quotaQ.Where("redemptions.tenant_id = ?", tenantId)
	}
	if err := quotaQ.Scan(&totalQuota).Error; err != nil {
		return nil, err
	}
	result.TotalQuota = totalQuota.Total

	// Usage rate
	if result.TotalCreated > 0 {
		result.UsageRate = float64(result.TotalUsed) / float64(result.TotalCreated) * 100
	}

	return &result, nil
}

// --- Subscription Heatmap ---

type SubscriptionHeatmapItem struct {
	Date              string  `json:"date"`
	TotalQuota        int64   `json:"total_quota"`
	UsedQuota         int64   `json:"used_quota"`
	SubscriptionCount int     `json:"subscription_count"`
	IsFuture          bool    `json:"is_future"`
}

// GetSubscriptionHeatmap returns daily quota usage data for a calendar heatmap.
// For past/today: shows real subscription consumption aggregated from LOG_DB.
// For future: shows count of active subscriptions covering that day.
func GetSubscriptionHeatmap(tenantId int, startTime, endTime int64, planID int) ([]SubscriptionHeatmapItem, error) {
	// Limit to 400 days max (supports one year forward heatmap)
	maxDuration := int64(400 * 24 * 3600)
	if endTime-startTime > maxDuration {
		startTime = endTime - maxDuration
	}

	type subRow struct {
		StartTime   int64  `gorm:"column:start_time"`
		EndTime     int64  `gorm:"column:end_time"`
		AmountTotal int64  `gorm:"column:amount_total"`
		AmountUsed  int64  `gorm:"column:amount_used"`
		Status      string `gorm:"column:status"`
	}
	var subs []subRow
	heatQ := DB.Table("user_subscriptions").
		Select("start_time, end_time, amount_total, amount_used, status").
		Where("start_time <= ? AND end_time >= ?", endTime, startTime).
		Where("amount_total > 0")
	if tenantId > 0 {
		heatQ = heatQ.Where("user_subscriptions.tenant_id = ?", tenantId)
	}
	if planID > 0 {
		heatQ = heatQ.Where("plan_id = ?", planID)
	}
	if err := heatQ.Scan(&subs).Error; err != nil {
		return nil, err
	}

	now := time.Now().Unix()

	// Extend endTime to cover future days with active subscriptions
	effectiveEnd := endTime
	for _, s := range subs {
		if s.EndTime > effectiveEnd {
			effectiveEnd = s.EndTime
		}
	}
	if effectiveEnd-startTime > maxDuration {
		effectiveEnd = startTime + maxDuration
	}

	// Normalize to day boundaries using TZ offset
	offsetSec := int64(common.AnalyticsTZOffset * 3600)
	dayStart := ((startTime + offsetSec) / 86400) * 86400 - offsetSec
	dayEnd := ((effectiveEnd + offsetSec) / 86400) * 86400 - offsetSec

	// Aggregate real subscription consumption from LOG_DB for past/today days
	usedQuotaByDate := make(map[string]int64)
	logEnd := dayEnd + 86400 - 1
	if logEnd > now {
		logEnd = now
	}
	if logEnd >= dayStart {
		type logRow struct {
			CreatedAt int64  `gorm:"column:created_at"`
			Other     string `gorm:"column:other"`
		}
		var logRows []logRow
		logQ := LOG_DB.Table("logs").
			Select("created_at, other").
			Where("type = ?", LogTypeConsume).
			Where("created_at >= ? AND created_at <= ?", dayStart, logEnd).
			Where("other LIKE ?", "%subscription_consumed%")
		if tenantId > 0 {
			logQ = logQ.Where("logs.tenant_id = ?", tenantId)
		}
		if err := logQ.Scan(&logRows).Error; err != nil {
			return nil, err
		}
		for _, row := range logRows {
			m, err := common.StrToMap(row.Other)
			if err != nil || m == nil {
				continue
			}
			bs, _ := m["billing_source"].(string)
			if bs != "subscription" {
				continue
			}
			consumed := getFloat64FromMap(m, "subscription_consumed")
			if consumed <= 0 {
				continue
			}
			if planID > 0 {
				planVal, hasPlan := m["subscription_plan_id"]
				if !hasPlan {
					continue
				}
				planFloat, ok2 := planVal.(float64)
				if !ok2 || int(planFloat) != planID {
					continue
				}
			}
			dayTs := ((row.CreatedAt + offsetSec) / 86400) * 86400 - offsetSec
			dateStr := time.Unix(dayTs+offsetSec, 0).UTC().Format("2006-01-02")
			usedQuotaByDate[dateStr] += int64(consumed)
		}
	}

	var result []SubscriptionHeatmapItem
	for day := dayStart; day <= dayEnd; day += 86400 {
		dayEndTs := day + 86400 - 1
		dateStr := time.Unix(day+offsetSec, 0).UTC().Format("2006-01-02")
		isFuture := day > now

		item := SubscriptionHeatmapItem{
			Date:     dateStr,
			IsFuture: isFuture,
		}

		for _, s := range subs {
			if s.StartTime <= dayEndTs && s.EndTime >= day {
				item.SubscriptionCount++
				item.TotalQuota += s.AmountTotal
			}
		}

		if !isFuture {
			item.UsedQuota = usedQuotaByDate[dateStr]
		}

		result = append(result, item)
	}

	return result, nil
}

func GetDAUTrend(tenantId int, startTime, endTime int64, granularity string) ([]DAUTrendItem, error) {
	bucketExpr := dateTruncExpr("created_at", granularity)

	// Query API active user IDs per bucket
	type bucketUserRow struct {
		TimeBucket string `gorm:"column:time_bucket"`
		UserId     int    `gorm:"column:user_id"`
	}

	var apiUserRows []bucketUserRow
	apiQ := LOG_DB.Table("logs").
		Select(bucketExpr + " as time_bucket, user_id").
		Where("type = ?", LogTypeConsume).
		Where("user_id > 0")
	if tenantId > 0 {
		apiQ = apiQ.Where("logs.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		apiQ = apiQ.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		apiQ = apiQ.Where("created_at <= ?", endTime)
	}
	apiQ = apiQ.Group(bucketExpr + ", user_id")
	if err := apiQ.Scan(&apiUserRows).Error; err != nil {
		return nil, err
	}

	// Query login active user IDs per bucket
	var loginUserRows []bucketUserRow
	loginQ := DB.Table("user_ip_records").
		Select(bucketExpr + " as time_bucket, user_id").
		Where("user_id > 0")
	if tenantId > 0 {
		loginQ = loginQ.Where("user_ip_records.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		loginQ = loginQ.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		loginQ = loginQ.Where("created_at <= ?", endTime)
	}
	loginQ = loginQ.Group(bucketExpr + ", user_id")
	if err := loginQ.Scan(&loginUserRows).Error; err != nil {
		return nil, err
	}

	// Build per-bucket user sets
	type bucketSets struct {
		apiUsers   map[int]struct{}
		loginUsers map[int]struct{}
	}
	buckets := make(map[string]*bucketSets)
	for _, row := range apiUserRows {
		bs, ok := buckets[row.TimeBucket]
		if !ok {
			bs = &bucketSets{apiUsers: make(map[int]struct{}), loginUsers: make(map[int]struct{})}
			buckets[row.TimeBucket] = bs
		}
		bs.apiUsers[row.UserId] = struct{}{}
	}
	for _, row := range loginUserRows {
		bs, ok := buckets[row.TimeBucket]
		if !ok {
			bs = &bucketSets{apiUsers: make(map[int]struct{}), loginUsers: make(map[int]struct{})}
			buckets[row.TimeBucket] = bs
		}
		bs.loginUsers[row.UserId] = struct{}{}
	}

	// Compute counts with true union for total
	result := make([]DAUTrendItem, 0, len(buckets))
	for tb, bs := range buckets {
		unionSet := make(map[int]struct{}, len(bs.apiUsers)+len(bs.loginUsers))
		for uid := range bs.apiUsers {
			unionSet[uid] = struct{}{}
		}
		for uid := range bs.loginUsers {
			unionSet[uid] = struct{}{}
		}
		result = append(result, DAUTrendItem{
			TimeBucket:       tb,
			APIActiveUsers:   int64(len(bs.apiUsers)),
			LoginActiveUsers: int64(len(bs.loginUsers)),
			TotalActiveUsers: int64(len(unionSet)),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TimeBucket < result[j].TimeBucket
	})

	return result, nil
}

func GetRegistrationTrend(tenantId int, startTime, endTime int64, granularity string) ([]RegistrationTrendItem, error) {
	bucketExpr := dateTruncExpr("created_at", granularity)

	type regRow struct {
		TimeBucket string `gorm:"column:time_bucket"`
		UserCount  int64  `gorm:"column:user_count"`
	}

	var newUserRows []regRow
	newUserQ := LOG_DB.Table("logs").
		Select(bucketExpr + " as time_bucket, COUNT(DISTINCT user_id) as user_count").
		Where("type = ?", LogTypeSystem).
		Where("content LIKE ?", "新用户注册赠送%").
		Where("user_id > 0")
	if tenantId > 0 {
		newUserQ = newUserQ.Where("logs.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		newUserQ = newUserQ.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		newUserQ = newUserQ.Where("created_at <= ?", endTime)
	}
	newUserQ = newUserQ.Group(bucketExpr)
	if err := newUserQ.Scan(&newUserRows).Error; err != nil {
		return nil, err
	}

	var referredRows []regRow
	referredQ := DB.Table("aff_rebate_logs").
		Select(bucketExpr + " as time_bucket, COUNT(DISTINCT invitee_id) as user_count").
		Where("type = ?", AffRebateTypeRegister).
		Where("invitee_id > 0")
	if tenantId > 0 {
		referredQ = referredQ.Where("aff_rebate_logs.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		referredQ = referredQ.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		referredQ = referredQ.Where("created_at <= ?", endTime)
	}
	referredQ = referredQ.Group(bucketExpr)
	if err := referredQ.Scan(&referredRows).Error; err != nil {
		return nil, err
	}

	merged := make(map[string]*RegistrationTrendItem)
	for _, row := range newUserRows {
		merged[row.TimeBucket] = &RegistrationTrendItem{
			TimeBucket: row.TimeBucket,
			NewUsers:   row.UserCount,
		}
	}
	for _, row := range referredRows {
		item, ok := merged[row.TimeBucket]
		if !ok {
			item = &RegistrationTrendItem{TimeBucket: row.TimeBucket}
			merged[row.TimeBucket] = item
		}
		item.ReferredUsers = row.UserCount
	}

	result := make([]RegistrationTrendItem, 0, len(merged))
	for _, item := range merged {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TimeBucket < result[j].TimeBucket
	})

	return result, nil
}

func GetConversionFunnel(tenantId int, startTime, endTime int64) (*ConversionFunnelResult, error) {
	result := &ConversionFunnelResult{}

	usersQ := DB.Table("users").Where("status = 1")
	if tenantId > 0 {
		usersQ = usersQ.Where("users.tenant_id = ?", tenantId)
	}
	if err := usersQ.Count(&result.TotalUsers).Error; err != nil {
		return nil, err
	}

	// Collect per-user order counts from top_ups
	type userCountRow struct {
		UserId int   `gorm:"column:user_id"`
		Count  int64 `gorm:"column:cnt"`
	}
	var topupCounts []userCountRow
	topupQ := DB.Table("top_ups").
		Select("user_id, COUNT(*) as cnt").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("user_id > 0").
		Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
	if tenantId > 0 {
		topupQ = topupQ.Where("top_ups.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		topupQ = topupQ.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		topupQ = topupQ.Where("complete_time <= ?", endTime)
	}
	topupQ = topupQ.Group("user_id")
	if err := topupQ.Scan(&topupCounts).Error; err != nil {
		return nil, err
	}

	// Collect per-user order counts from subscription_orders
	var subCounts []userCountRow
	subQ := DB.Table("subscription_orders").
		Select("user_id, COUNT(*) as cnt").
		Where("status = ?", common.TopUpStatusSuccess).
		Where("user_id > 0")
	if tenantId > 0 {
		subQ = subQ.Where("subscription_orders.tenant_id = ?", tenantId)
	}
	if startTime > 0 {
		subQ = subQ.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		subQ = subQ.Where("complete_time <= ?", endTime)
	}
	subQ = subQ.Group("user_id")
	if err := subQ.Scan(&subCounts).Error; err != nil {
		return nil, err
	}

	// Merge in Go: union by user_id, sum order counts
	userOrderCount := make(map[int]int64)
	for _, r := range topupCounts {
		userOrderCount[r.UserId] += r.Count
	}
	for _, r := range subCounts {
		userOrderCount[r.UserId] += r.Count
	}

	result.PayingUsers = int64(len(userOrderCount))
	for _, cnt := range userOrderCount {
		if cnt > 1 {
			result.RepeatBuyers++
		}
	}

	if result.TotalUsers > 0 {
		result.ConversionRate = float64(result.PayingUsers) / float64(result.TotalUsers) * 100
	}
	if result.PayingUsers > 0 {
		result.RepeatRate = float64(result.RepeatBuyers) / float64(result.PayingUsers) * 100
	}

	return result, nil
}

func GetReferralAnalytics(tenantId int, startTime, endTime int64, limit int) ([]ReferralAnalyticsItem, error) {
	if limit <= 0 {
		limit = 20
	}

	// Step 1: aggregate referred_count per inviter from users table
	type refCountRow struct {
		InviterId     int   `gorm:"column:inviter_id"`
		ReferredCount int64 `gorm:"column:referred_count"`
	}
	var refCounts []refCountRow
	refQ := DB.Table("users").
		Select("inviter_id, COUNT(*) as referred_count").
		Where("inviter_id > 0").
		Where("status = 1")
	if tenantId > 0 {
		refQ = refQ.Where("users.tenant_id = ?", tenantId)
	}
	if err := refQ.Group("inviter_id").
		Scan(&refCounts).Error; err != nil {
		return nil, err
	}
	if len(refCounts) == 0 {
		return []ReferralAnalyticsItem{}, nil
	}

	// Build inviter→count map
	inviterMap := make(map[int]int64)
	inviterIDs := make([]int, 0, len(refCounts))
	for _, r := range refCounts {
		inviterMap[r.InviterId] = r.ReferredCount
		inviterIDs = append(inviterIDs, r.InviterId)
	}

	// Collect invitee IDs per inviter for revenue lookup
	type inviteeRow struct {
		Id        int `gorm:"column:id"`
		InviterId int `gorm:"column:inviter_id"`
	}
	var inviteeRows []inviteeRow
	inviteeQ := DB.Table("users").
		Select("id, inviter_id").
		Where("inviter_id IN ?", inviterIDs).
		Where("status = 1")
	if tenantId > 0 {
		inviteeQ = inviteeQ.Where("users.tenant_id = ?", tenantId)
	}
	if err := inviteeQ.Scan(&inviteeRows).Error; err != nil {
		return nil, err
	}

	// Build invitee→inviter mapping
	inviteeToInviter := make(map[int]int)
	for _, r := range inviteeRows {
		inviteeToInviter[r.Id] = r.InviterId
	}
	allInviteeIDs := make([]int, 0, len(inviteeToInviter))
	for id := range inviteeToInviter {
		allInviteeIDs = append(allInviteeIDs, id)
	}

	// Step 2: aggregate topup revenue by invitee (time filter on complete_time)
	type revenueRow struct {
		UserId  int     `gorm:"column:user_id"`
		Revenue float64 `gorm:"column:revenue"`
	}
	inviterRevenue := make(map[int]float64)

	if len(allInviteeIDs) > 0 {
		topupQ := DB.Table("top_ups").
			Select("user_id, COALESCE(SUM(money), 0) as revenue").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("user_id IN ?", allInviteeIDs).
			Where("trade_no NOT LIKE 'SUB%' AND trade_no NOT LIKE 'sub_ref_%'")
		if tenantId > 0 {
			topupQ = topupQ.Where("top_ups.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			topupQ = topupQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			topupQ = topupQ.Where("complete_time <= ?", endTime)
		}
		var topupRevRows []revenueRow
		if err := topupQ.Group("user_id").Scan(&topupRevRows).Error; err != nil {
			return nil, err
		}
		for _, r := range topupRevRows {
			if inviterID, ok := inviteeToInviter[r.UserId]; ok {
				inviterRevenue[inviterID] += r.Revenue
			}
		}

		// Step 3: aggregate subscription revenue by invitee (time filter on complete_time)
		subQ := DB.Table("subscription_orders").
			Select("user_id, COALESCE(SUM(money), 0) as revenue").
			Where("status = ?", common.TopUpStatusSuccess).
			Where("user_id IN ?", allInviteeIDs)
		if tenantId > 0 {
			subQ = subQ.Where("subscription_orders.tenant_id = ?", tenantId)
		}
		if startTime > 0 {
			subQ = subQ.Where("complete_time >= ?", startTime)
		}
		if endTime > 0 {
			subQ = subQ.Where("complete_time <= ?", endTime)
		}
		var subRevRows []revenueRow
		if err := subQ.Group("user_id").Scan(&subRevRows).Error; err != nil {
			return nil, err
		}
		for _, r := range subRevRows {
			if inviterID, ok := inviteeToInviter[r.UserId]; ok {
				inviterRevenue[inviterID] += r.Revenue
			}
		}
	}

	// Step 4: combine into result items
	items := make([]ReferralAnalyticsItem, 0, len(inviterMap))
	for inviterID, referredCount := range inviterMap {
		items = append(items, ReferralAnalyticsItem{
			UserId:          inviterID,
			ReferredCount:   referredCount,
			ReferredRevenue: inviterRevenue[inviterID],
		})
	}

	// Sort by referred_revenue desc, then referred_count desc
	sort.Slice(items, func(i, j int) bool {
		if items[i].ReferredRevenue != items[j].ReferredRevenue {
			return items[i].ReferredRevenue > items[j].ReferredRevenue
		}
		return items[i].ReferredCount > items[j].ReferredCount
	})
	if len(items) > limit {
		items = items[:limit]
	}

	// Step 5: batch load inviter usernames
	topUserIDs := make([]int, 0, len(items))
	for _, item := range items {
		if item.UserId > 0 {
			topUserIDs = append(topUserIDs, item.UserId)
		}
	}
	userNameMap := make(map[int]string)
	if len(topUserIDs) > 0 {
		var users []struct {
			Id       int    `gorm:"column:id"`
			Username string `gorm:"column:username"`
		}
		usersQ := DB.Table("users").Select("id, username").Where("id IN ?", topUserIDs)
		if tenantId > 0 {
			usersQ = usersQ.Where("users.tenant_id = ?", tenantId)
		}
		usersQ.Find(&users)
		for _, u := range users {
			userNameMap[u.Id] = u.Username
		}
	}
	for i := range items {
		if name, ok := userNameMap[items[i].UserId]; ok {
			items[i].Inviter = name
		} else {
			items[i].Inviter = fmt.Sprintf("user#%d", items[i].UserId)
		}
	}

	return items, nil
}
