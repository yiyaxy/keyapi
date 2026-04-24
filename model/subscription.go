package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/samber/hot"
	"gorm.io/gorm"
)

// Subscription duration units
const (
	SubscriptionDurationYear   = "year"
	SubscriptionDurationMonth  = "month"
	SubscriptionDurationDay    = "day"
	SubscriptionDurationHour   = "hour"
	SubscriptionDurationCustom = "custom"
)

// Subscription quota reset period
const (
	SubscriptionResetNever   = "never"
	SubscriptionResetDaily   = "daily"
	SubscriptionResetWeekly  = "weekly"
	SubscriptionResetMonthly = "monthly"
	SubscriptionResetCustom  = "custom"
)

// Subscription plan status
const (
	SubscriptionPlanStatusActive   = "active"
	SubscriptionPlanStatusSoldOut  = "sold_out"
	SubscriptionPlanStatusDisabled = "disabled"
)

var (
	ErrSubscriptionOrderNotFound      = errors.New("subscription order not found")
	ErrSubscriptionOrderStatusInvalid = errors.New("subscription order status invalid")
)

const (
	subscriptionPlanCacheNamespace     = "new-api:subscription_plan:v1"
	subscriptionPlanInfoCacheNamespace = "new-api:subscription_plan_info:v1"
)

var (
	subscriptionPlanCacheOnce     sync.Once
	subscriptionPlanInfoCacheOnce sync.Once

	subscriptionPlanCache     *cachex.HybridCache[SubscriptionPlan]
	subscriptionPlanInfoCache *cachex.HybridCache[SubscriptionPlanInfo]
)

func subscriptionPlanCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_TTL", 300)
	if ttlSeconds <= 0 {
		ttlSeconds = 300
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanInfoCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_TTL", 120)
	if ttlSeconds <= 0 {
		ttlSeconds = 120
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_CAP", 5000)
	if capacity <= 0 {
		capacity = 5000
	}
	return capacity
}

func subscriptionPlanInfoCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_CAP", 10000)
	if capacity <= 0 {
		capacity = 10000
	}
	return capacity
}

func getSubscriptionPlanCache() *cachex.HybridCache[SubscriptionPlan] {
	subscriptionPlanCacheOnce.Do(func() {
		ttl := subscriptionPlanCacheTTL()
		subscriptionPlanCache = cachex.NewHybridCache[SubscriptionPlan](cachex.HybridCacheConfig[SubscriptionPlan]{
			Namespace: cachex.Namespace(subscriptionPlanCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlan]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlan] {
				return hot.NewHotCache[string, SubscriptionPlan](hot.LRU, subscriptionPlanCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanCache
}

func getSubscriptionPlanInfoCache() *cachex.HybridCache[SubscriptionPlanInfo] {
	subscriptionPlanInfoCacheOnce.Do(func() {
		ttl := subscriptionPlanInfoCacheTTL()
		subscriptionPlanInfoCache = cachex.NewHybridCache[SubscriptionPlanInfo](cachex.HybridCacheConfig[SubscriptionPlanInfo]{
			Namespace: cachex.Namespace(subscriptionPlanInfoCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlanInfo]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlanInfo] {
				return hot.NewHotCache[string, SubscriptionPlanInfo](hot.LRU, subscriptionPlanInfoCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanInfoCache
}

func subscriptionPlanCacheKey(tenantId int, id int) string {
	if id <= 0 {
		return ""
	}
	if tenantId > 0 {
		return fmt.Sprintf("%d:%d", tenantId, id)
	}
	return strconv.Itoa(id)
}

func InvalidateSubscriptionPlanCache(planId int) {
	if planId <= 0 {
		return
	}
	cache := getSubscriptionPlanCache()
	// Invalidate both tenant-scoped and global keys
	_, _ = cache.DeleteMany([]string{subscriptionPlanCacheKey(0, planId)})
	infoCache := getSubscriptionPlanInfoCache()
	_ = infoCache.Purge()
}

// Subscription plan
type SubscriptionPlan struct {
	Id       int `json:"id"`
	TenantId int `json:"tenant_id" gorm:"index;default:1"`

	Title           string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle        string `json:"subtitle" gorm:"type:varchar(255);default:''"`
	PromoHighlights string `json:"promo_highlights" gorm:"type:text;default:''"`

	// Display money amount (follow existing code style: float64 for money)
	PriceAmount float64 `json:"price_amount" gorm:"not null;default:0"`
	Currency    string  `json:"currency" gorm:"type:varchar(8);not null;default:'USD'"`

	DurationUnit  string `json:"duration_unit" gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue int    `json:"duration_value" gorm:"type:int;not null;default:1"`
	CustomSeconds int64  `json:"custom_seconds" gorm:"type:bigint;not null;default:0"`

	Status    string `json:"status" gorm:"type:varchar(16);not null;default:'active';index"`
	Enabled   bool   `json:"enabled" gorm:"default:true"`
	SortOrder int    `json:"sort_order" gorm:"type:int;default:0"`

	StripePriceId  string `json:"stripe_price_id" gorm:"type:varchar(128);default:''"`
	CreemProductId string `json:"creem_product_id" gorm:"type:varchar(128);default:''"`

	// Max purchases per user (0 = unlimited)
	MaxPurchasePerUser int `json:"max_purchase_per_user" gorm:"type:int;default:0"`

	// Upgrade user group after purchase (empty = no change)
	UpgradeGroup string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`

	// Total quota (amount in quota units, 0 = unlimited)
	TotalAmount int64 `json:"total_amount" gorm:"type:bigint;not null;default:0"`

	// Quota reset period for plan
	QuotaResetPeriod        string `json:"quota_reset_period" gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64  `json:"quota_reset_custom_seconds" gorm:"type:bigint;default:0"`

	// Inviter reward amount in USD (0 = no reward)
	InviterRewardAmount float64 `json:"inviter_reward_amount" gorm:"not null;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (p *SubscriptionPlan) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.Status = NormalizeSubscriptionPlanStatus(p.Status)
	p.Enabled = SubscriptionPlanStatusAllowsPublicList(p.Status)
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *SubscriptionPlan) BeforeUpdate(tx *gorm.DB) error {
	p.Status = NormalizeSubscriptionPlanStatus(p.Status)
	p.Enabled = SubscriptionPlanStatusAllowsPublicList(p.Status)
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

// Subscription order (payment -> webhook -> create UserSubscription)
type SubscriptionOrder struct {
	Id       int     `json:"id"`
	TenantId int     `json:"tenant_id" gorm:"index;default:1"`
	UserId   int     `json:"user_id" gorm:"index"`
	PlanId   int     `json:"plan_id" gorm:"index"`
	Money    float64 `json:"money"`

	TradeNo       string `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod string `json:"payment_method" gorm:"type:varchar(50)"`
	Status        string `json:"status"`
	CreateTime    int64  `json:"create_time"`
	CompleteTime  int64  `json:"complete_time"`
	ClientIP      string `json:"client_ip" gorm:"type:varchar(64);default:''"`

	ProviderPayload string `json:"provider_payload" gorm:"type:text"`

	// Epay callback snapshot fields (populated on success notify/return)
	EpayTradeNo       string `json:"epay_trade_no" gorm:"type:varchar(128);default:''"`
	EpayOrderIdWxAl   string `json:"epay_order_id_wx_al" gorm:"type:varchar(128);default:''"`
	EpayType          string `json:"epay_type" gorm:"type:varchar(32);default:''"`
	EpayTdid          string `json:"epay_tdid" gorm:"type:varchar(128);default:''"`
	EpayPid           string `json:"epay_pid" gorm:"type:varchar(64);default:''"`
	EpayTradeStatus   string `json:"epay_trade_status" gorm:"type:varchar(64);default:''"`
	EpayNotifyPayload string `json:"epay_notify_payload" gorm:"type:text;default:''"`
}

// SubscriptionOrderWithUser is a DTO for admin queries that includes the username.
type SubscriptionOrderWithUser struct {
	SubscriptionOrder
	Username string `json:"username"`
}

func (o *SubscriptionOrder) Insert() error {
	if o.CreateTime == 0 {
		o.CreateTime = common.GetTimestamp()
	}
	return DB.Create(o).Error
}

func (o *SubscriptionOrder) Update() error {
	return DB.Save(o).Error
}

func GetSubscriptionOrderByTradeNo(tradeNo string, tenantId ...int) *SubscriptionOrder {
	if tradeNo == "" {
		return nil
	}
	var order SubscriptionOrder
	query := DB.Where("trade_no = ?", tradeNo)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	if err := query.First(&order).Error; err != nil {
		return nil
	}
	return &order
}

// User subscription instance
const (
	UserSubscriptionStatusInactive  = "inactive"
	UserSubscriptionStatusActive    = "active"
	UserSubscriptionStatusExpired   = "expired"
	UserSubscriptionStatusCancelled = "cancelled"
)

type UserSubscription struct {
	Id       int `json:"id"`
	TenantId int `json:"tenant_id" gorm:"index;default:1"`
	UserId   int `json:"user_id" gorm:"index;index:idx_user_sub_active,priority:1"`
	PlanId   int `json:"plan_id" gorm:"index"`

	AmountTotal int64 `json:"amount_total" gorm:"type:bigint;not null;default:0"`
	AmountUsed  int64 `json:"amount_used" gorm:"type:bigint;not null;default:0"`

	StartTime int64  `json:"start_time" gorm:"bigint"`
	EndTime   int64  `json:"end_time" gorm:"bigint;index;index:idx_user_sub_active,priority:3"`
	Status    string `json:"status" gorm:"type:varchar(32);index;index:idx_user_sub_active,priority:2"` // active/expired/cancelled

	Source string `json:"source" gorm:"type:varchar(32);default:'order'"` // order/admin

	LastResetTime int64 `json:"last_reset_time" gorm:"type:bigint;default:0"`
	NextResetTime int64 `json:"next_reset_time" gorm:"type:bigint;default:0;index"`

	UpgradeGroup  string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`
	PrevUserGroup string `json:"prev_user_group" gorm:"type:varchar(64);default:''"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (s *UserSubscription) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	return nil
}

func (s *UserSubscription) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type SubscriptionSummary struct {
	Subscription *UserSubscription `json:"subscription"`
}

func calcPlanEndTime(start time.Time, plan *SubscriptionPlan) (int64, error) {
	if plan == nil {
		return 0, errors.New("plan is nil")
	}
	if plan.DurationValue <= 0 && plan.DurationUnit != SubscriptionDurationCustom {
		return 0, errors.New("duration_value must be > 0")
	}
	switch plan.DurationUnit {
	case SubscriptionDurationYear:
		return start.AddDate(plan.DurationValue, 0, 0).Unix(), nil
	case SubscriptionDurationMonth:
		return start.AddDate(0, plan.DurationValue, 0).Unix(), nil
	case SubscriptionDurationDay:
		return start.Add(time.Duration(plan.DurationValue) * 24 * time.Hour).Unix(), nil
	case SubscriptionDurationHour:
		return start.Add(time.Duration(plan.DurationValue) * time.Hour).Unix(), nil
	case SubscriptionDurationCustom:
		if plan.CustomSeconds <= 0 {
			return 0, errors.New("custom_seconds must be > 0")
		}
		return start.Add(time.Duration(plan.CustomSeconds) * time.Second).Unix(), nil
	default:
		return 0, fmt.Errorf("invalid duration_unit: %s", plan.DurationUnit)
	}
}

func NormalizeResetPeriod(period string) string {
	switch strings.TrimSpace(period) {
	case SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly, SubscriptionResetCustom:
		return strings.TrimSpace(period)
	default:
		return SubscriptionResetNever
	}
}

func NormalizeSubscriptionPlanStatus(status string) string {
	switch strings.TrimSpace(status) {
	case SubscriptionPlanStatusActive, SubscriptionPlanStatusSoldOut, SubscriptionPlanStatusDisabled:
		return strings.TrimSpace(status)
	default:
		return SubscriptionPlanStatusActive
	}
}

func SubscriptionPlanStatusAllowsPublicList(status string) bool {
	normalized := NormalizeSubscriptionPlanStatus(status)
	return normalized == SubscriptionPlanStatusActive || normalized == SubscriptionPlanStatusSoldOut
}

func SubscriptionPlanStatusAllowsPurchase(status string) bool {
	return NormalizeSubscriptionPlanStatus(status) == SubscriptionPlanStatusActive
}

func SubscriptionPlanPurchaseError(status string) string {
	switch NormalizeSubscriptionPlanStatus(status) {
	case SubscriptionPlanStatusSoldOut:
		return "套餐已售罄"
	case SubscriptionPlanStatusDisabled:
		return "套餐未启用"
	default:
		return "套餐不可购买"
	}
}

func calcNextResetTime(base time.Time, plan *SubscriptionPlan, endUnix int64) int64 {
	if plan == nil {
		return 0
	}
	period := NormalizeResetPeriod(plan.QuotaResetPeriod)
	if period == SubscriptionResetNever {
		return 0
	}
	var next time.Time
	switch period {
	case SubscriptionResetDaily:
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, 1)
	case SubscriptionResetWeekly:
		// Align to next Monday 00:00
		weekday := int(base.Weekday()) // Sunday=0
		// Convert to Monday=1..Sunday=7
		if weekday == 0 {
			weekday = 7
		}
		daysUntil := 8 - weekday
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, daysUntil)
	case SubscriptionResetMonthly:
		// Align to first day of next month 00:00
		next = time.Date(base.Year(), base.Month(), 1, 0, 0, 0, 0, base.Location()).
			AddDate(0, 1, 0)
	case SubscriptionResetCustom:
		if plan.QuotaResetCustomSeconds <= 0 {
			return 0
		}
		next = base.Add(time.Duration(plan.QuotaResetCustomSeconds) * time.Second)
	default:
		return 0
	}
	if endUnix > 0 && next.Unix() > endUnix {
		return 0
	}
	return next.Unix()
}

func GetSubscriptionPlanById(tenantId int, id int) (*SubscriptionPlan, error) {
	return getSubscriptionPlanByIdTx(nil, tenantId, id)
}

func getSubscriptionPlanByIdTx(tx *gorm.DB, tenantId int, id int) (*SubscriptionPlan, error) {
	if id <= 0 {
		return nil, errors.New("invalid plan id")
	}
	key := subscriptionPlanCacheKey(tenantId, id)
	if key != "" {
		if cached, found, err := getSubscriptionPlanCache().Get(key); err == nil && found {
			return &cached, nil
		}
	}
	var plan SubscriptionPlan
	query := DB
	if tx != nil {
		query = tx
	}
	query = query.Where("id = ?", id)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.First(&plan).Error; err != nil {
		return nil, err
	}
	_ = getSubscriptionPlanCache().SetWithTTL(key, plan, subscriptionPlanCacheTTL())
	return &plan, nil
}

func CountUserSubscriptionsByPlan(tenantId int, userId int, planId int) (int64, error) {
	if userId <= 0 || planId <= 0 {
		return 0, errors.New("invalid userId or planId")
	}
	var count int64
	query := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND plan_id = ?", userId, planId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func getUserGroupByIdTx(tx *gorm.DB, tenantId int, userId int) (string, error) {
	if userId <= 0 || tenantId <= 0 {
		return "", errors.New("invalid tenantId/userId")
	}
	if tx == nil {
		tx = DB
	}
	var group string
	if err := tx.Model(&User{}).
		Where("id = ? AND tenant_id = ?", userId, tenantId).
		Select(commonGroupCol).Find(&group).Error; err != nil {
		return "", err
	}
	return group, nil
}

func downgradeUserGroupForSubscriptionTx(tx *gorm.DB, sub *UserSubscription, now int64) (string, error) {
	if tx == nil || sub == nil {
		return "", errors.New("invalid downgrade args")
	}
	upgradeGroup := strings.TrimSpace(sub.UpgradeGroup)
	if upgradeGroup == "" {
		return "", nil
	}
	currentGroup, err := getUserGroupByIdTx(tx, sub.TenantId, sub.UserId)
	if err != nil {
		return "", err
	}
	if currentGroup != upgradeGroup {
		return "", nil
	}
	var activeSub UserSubscription
	activeQuery := tx.Where("user_id = ? AND tenant_id = ? AND status = ? AND end_time > ? AND id <> ? AND upgrade_group <> ''",
		sub.UserId, sub.TenantId, "active", now, sub.Id).
		Order("end_time desc, id desc").
		Limit(1).
		Find(&activeSub)
	if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
		return "", nil
	}
	prevGroup := strings.TrimSpace(sub.PrevUserGroup)
	if prevGroup == "" || prevGroup == currentGroup {
		return "", nil
	}
	if err := tx.Model(&User{}).
		Where("id = ? AND tenant_id = ?", sub.UserId, sub.TenantId).
		Update("group", prevGroup).Error; err != nil {
		return "", err
	}
	return prevGroup, nil
}

func CreateUserSubscriptionFromPlanTx(tx *gorm.DB, tenantId int, userId int, plan *SubscriptionPlan, source string, deferActivation ...bool) (*UserSubscription, error) {
	if tx == nil {
		return nil, errors.New("tx is nil")
	}
	if plan == nil || plan.Id == 0 {
		return nil, errors.New("invalid plan")
	}
	if tenantId <= 0 || userId <= 0 {
		return nil, errors.New("invalid tenantId/userId")
	}
	if plan.MaxPurchasePerUser > 0 {
		var count int64
		if err := tx.Model(&UserSubscription{}).
			Where("user_id = ? AND tenant_id = ? AND plan_id = ?", userId, tenantId, plan.Id).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			return nil, errors.New("已达到该套餐购买上限")
		}
	}

	shouldDefer := len(deferActivation) > 0 && deferActivation[0]

	if shouldDefer {
		// Deferred activation: create as inactive, no time calculation, no group upgrade
		sub := &UserSubscription{
			TenantId:      tenantId,
			UserId:        userId,
			PlanId:        plan.Id,
			AmountTotal:   plan.TotalAmount,
			AmountUsed:    0,
			StartTime:     0,
			EndTime:       0,
			Status:        UserSubscriptionStatusInactive,
			Source:        source,
			LastResetTime: 0,
			NextResetTime: 0,
			UpgradeGroup:  strings.TrimSpace(plan.UpgradeGroup),
			PrevUserGroup: "",
			CreatedAt:     common.GetTimestamp(),
			UpdatedAt:     common.GetTimestamp(),
		}
		if err := tx.Create(sub).Error; err != nil {
			return nil, err
		}
		return sub, nil
	}

	// Immediate activation (original behavior)
	nowUnix := GetDBTimestamp()
	now := time.Unix(nowUnix, 0)
	endUnix, err := calcPlanEndTime(now, plan)
	if err != nil {
		return nil, err
	}
	resetBase := now
	nextReset := calcNextResetTime(resetBase, plan, endUnix)
	lastReset := int64(0)
	if nextReset > 0 {
		lastReset = now.Unix()
	}
	upgradeGroup := strings.TrimSpace(plan.UpgradeGroup)
	prevGroup := ""
	if upgradeGroup != "" {
		currentGroup, err := getUserGroupByIdTx(tx, tenantId, userId)
		if err != nil {
			return nil, err
		}
		if currentGroup != upgradeGroup {
			prevGroup = currentGroup
			if err := tx.Model(&User{}).
				Where("id = ? AND tenant_id = ?", userId, tenantId).
				Update("group", upgradeGroup).Error; err != nil {
				return nil, err
			}
		}
	}
	sub := &UserSubscription{
		TenantId:      tenantId,
		UserId:        userId,
		PlanId:        plan.Id,
		AmountTotal:   plan.TotalAmount,
		AmountUsed:    0,
		StartTime:     now.Unix(),
		EndTime:       endUnix,
		Status:        "active",
		Source:        source,
		LastResetTime: lastReset,
		NextResetTime: nextReset,
		UpgradeGroup:  upgradeGroup,
		PrevUserGroup: prevGroup,
		CreatedAt:     common.GetTimestamp(),
		UpdatedAt:     common.GetTimestamp(),
	}
	if err := tx.Create(sub).Error; err != nil {
		return nil, err
	}
	return sub, nil
}

// Complete a subscription order (idempotent). Creates a UserSubscription snapshot from the plan.
func CompleteSubscriptionOrder(tradeNo string, providerPayload string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logPlanTitle string
	var logMoney float64
	var logPaymentMethod string
	var logRewardAmount float64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrSubscriptionOrderStatusInvalid
		}
		plan, err := GetSubscriptionPlanById(0, order.PlanId)
		if err != nil {
			return err
		}
		if !plan.Enabled {
			// still allow completion for already purchased orders
		}
		_, err = CreateUserSubscriptionFromPlanTx(tx, order.TenantId, order.UserId, plan, "order", true)
		if err != nil {
			return err
		}
		if err := upsertSubscriptionTopUpTx(tx, &order); err != nil {
			return err
		}
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		if err := tx.Model(&SubscriptionOrder{}).
			Where("id = ? AND tenant_id = ?", order.Id, order.TenantId).
			Select("*").Updates(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logPlanTitle = plan.Title
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		logRewardAmount = plan.InviterRewardAmount
		return nil
	})
	if err != nil {
		return err
	}
	// Group upgrade is deferred to activation
	if logUserId > 0 {
		msg := fmt.Sprintf("订阅购买成功，套餐: %s，支付金额: %.2f，支付方式: %s（待激活）", logPlanTitle, logMoney, logPaymentMethod)
		if tenantId, terr := GetUserTenantId(logUserId); terr == nil {
			RecordTopUpLogWithTenant(tenantId, logUserId, 0, msg)
		} else {
			common.SysLog(fmt.Sprintf("failed to resolve subscription log tenant for user %d: %v", logUserId, terr))
		}
	}
	if logRewardAmount > 0 && logUserId > 0 {
		go ProcessSubscriptionRebate(logUserId, logRewardAmount, logPlanTitle)
	}
	return nil
}

// EpaySnapshot holds raw epay callback fields to persist on orders.
type EpaySnapshot struct {
	TradeNo       string // epay internal trade_no
	OrderIdWxAl   string // orderid_wx_al (alipay/wechat upstream transaction id)
	Type          string // payment type (alipay, wxpay, etc.)
	Tdid          string // tdid
	Pid           string // pid
	TradeStatus   string // trade_status from callback
	NotifyPayload string // full params JSON snapshot
}

// CompleteSubscriptionOrderWithEpay completes a subscription order and persists epay snapshot fields.
// It is idempotent: if already succeeded, the epay snapshot fields are still updated.
func CompleteSubscriptionOrderWithEpay(tradeNo string, providerPayload string, snap *EpaySnapshot) error {
	if snap == nil {
		return CompleteSubscriptionOrder(tradeNo, providerPayload)
	}
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logPlanTitle string
	var logMoney float64
	var logPaymentMethod string
	var logRewardAmount float64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		// Always persist epay snapshot (even if already success, idempotent update of snapshot fields)
		snapUpdates := map[string]interface{}{
			"epay_trade_no":       snap.TradeNo,
			"epay_order_id_wx_al": snap.OrderIdWxAl,
			"epay_type":           snap.Type,
			"epay_tdid":           snap.Tdid,
			"epay_pid":            snap.Pid,
			"epay_trade_status":   snap.TradeStatus,
			"epay_notify_payload": snap.NotifyPayload,
		}
		if err := tx.Model(&order).Updates(snapUpdates).Error; err != nil {
			return err
		}
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrSubscriptionOrderStatusInvalid
		}
		plan, err := GetSubscriptionPlanById(0, order.PlanId)
		if err != nil {
			return err
		}
		_, err = CreateUserSubscriptionFromPlanTx(tx, order.TenantId, order.UserId, plan, "order", true)
		if err != nil {
			return err
		}
		if err := upsertSubscriptionTopUpTx(tx, &order); err != nil {
			return err
		}
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		if err := tx.Model(&SubscriptionOrder{}).
			Where("id = ? AND tenant_id = ?", order.Id, order.TenantId).
			Select("*").Updates(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logPlanTitle = plan.Title
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		logRewardAmount = plan.InviterRewardAmount
		return nil
	})
	if err != nil {
		return err
	}
	// Group upgrade is deferred to activation
	if logUserId > 0 {
		msg := fmt.Sprintf("订阅购买成功，套餐: %s，支付金额: %.2f，支付方式: %s（待激活）", logPlanTitle, logMoney, logPaymentMethod)
		if tenantId, terr := GetUserTenantId(logUserId); terr == nil {
			RecordTopUpLogWithTenant(tenantId, logUserId, 0, msg)
		} else {
			common.SysLog(fmt.Sprintf("failed to resolve subscription log tenant for user %d: %v", logUserId, terr))
		}
	}
	if logRewardAmount > 0 && logUserId > 0 {
		go ProcessSubscriptionRebate(logUserId, logRewardAmount, logPlanTitle)
	}
	return nil
}

// ProcessSubscriptionRebate 处理订阅购买邀请人固定奖励
// 当被邀请人成功购买订阅时，给邀请人发放固定USD金额奖励
func ProcessSubscriptionRebate(userId int, rewardAmountUSD float64, planTitle string) {
	if rewardAmountUSD <= 0 {
		return
	}

	// 获取用户信息
	user, err := GetUserByIdGlobal(userId, true)
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessSubscriptionRebate: 获取用户信息失败 userId=%d, err=%v", userId, err))
		return
	}

	// 检查是否有邀请者
	if user.InviterId <= 0 {
		return
	}

	// 获取有效的返利设置（个性化 > 全局）
	rebateSetting := GetEffectiveRebateSetting(user.InviterId, user.TenantId)

	// 检查订阅返利是否启用（0=关闭）
	if rebateSetting.SubscriptionRebateCount == 0 {
		return
	}

	// 检查用户订阅购买次数是否在返利范围内（-1 表示无限次）
	if rebateSetting.SubscriptionRebateCount > 0 && user.SubscriptionPurchaseCount >= rebateSetting.SubscriptionRebateCount {
		return
	}

	// 转换 USD 为 quota
	rewardQuota := int(rewardAmountUSD * float64(common.QuotaPerUnit))
	if rewardQuota <= 0 {
		return
	}

	// 给邀请者增加 AffQuota 和 AffHistoryQuota
	err = DB.Model(&User{}).Where("id = ? AND tenant_id = ?", user.InviterId, user.TenantId).Updates(map[string]interface{}{
		"aff_quota":   gorm.Expr("aff_quota + ?", rewardQuota),
		"aff_history": gorm.Expr("aff_history + ?", rewardQuota),
	}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessSubscriptionRebate: 更新邀请者额度失败 inviterId=%d, err=%v", user.InviterId, err))
		return
	}

	// 记录返利日志
	CreateAffRebateLog(&AffRebateLog{
		TenantId:    user.TenantId,
		UserId:      user.InviterId,
		InviteeId:   userId,
		InviteeName: user.Username,
		Type:        AffRebateTypeSubscription,
		Quota:       rewardQuota,
		Remark:      fmt.Sprintf("订阅返利「%s」 %s", planTitle, logger.LogQuota(rewardQuota)),
	})

	// 被邀请人 subscription_purchase_count +1
	err = DB.Model(&User{}).Where("id = ? AND tenant_id = ?", userId, user.TenantId).Update("subscription_purchase_count", gorm.Expr("subscription_purchase_count + ?", 1)).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessSubscriptionRebate: 更新用户订阅购买次数失败 userId=%d, err=%v", userId, err))
		return
	}

	// 记录系统日志
	countDisplay := fmt.Sprintf("%d/%d", user.SubscriptionPurchaseCount+1, rebateSetting.SubscriptionRebateCount)
	if rebateSetting.SubscriptionRebateCount == -1 {
		countDisplay = fmt.Sprintf("%d/∞", user.SubscriptionPurchaseCount+1)
	}
	RecordLogWithTenant(user.TenantId, user.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户订阅返利「%s」 %s（订阅次数: %s）",
		planTitle, logger.LogQuota(rewardQuota), countDisplay))
	common.SysLog(fmt.Sprintf("ProcessSubscriptionRebate: 返利成功 inviterId=%d, userId=%d, rewardQuota=%d, planTitle=%s, count=%s",
		user.InviterId, userId, rewardQuota, planTitle, countDisplay))
}

func upsertSubscriptionTopUpTx(tx *gorm.DB, order *SubscriptionOrder) error {
	if tx == nil || order == nil {
		return errors.New("invalid subscription order")
	}
	now := common.GetTimestamp()
	var topup TopUp
	if err := tx.Where("trade_no = ?", order.TradeNo).First(&topup).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			topup = TopUp{
				TenantId:          order.TenantId,
				UserId:            order.UserId,
				Amount:            0,
				Money:             order.Money,
				TradeNo:           order.TradeNo,
				PaymentMethod:     order.PaymentMethod,
				CreateTime:        order.CreateTime,
				CompleteTime:      now,
				Status:            common.TopUpStatusSuccess,
				EpayTradeNo:       order.EpayTradeNo,
				EpayOrderIdWxAl:   order.EpayOrderIdWxAl,
				EpayType:          order.EpayType,
				EpayTdid:          order.EpayTdid,
				EpayPid:           order.EpayPid,
				EpayTradeStatus:   order.EpayTradeStatus,
				EpayNotifyPayload: order.EpayNotifyPayload,
			}
			return tx.Create(&topup).Error
		}
		return err
	}
	topup.Money = order.Money
	if topup.PaymentMethod == "" {
		topup.PaymentMethod = order.PaymentMethod
	}
	if topup.CreateTime == 0 {
		topup.CreateTime = order.CreateTime
	}
	topup.CompleteTime = now
	topup.Status = common.TopUpStatusSuccess
	topup.EpayTradeNo = order.EpayTradeNo
	topup.EpayOrderIdWxAl = order.EpayOrderIdWxAl
	topup.EpayType = order.EpayType
	topup.EpayTdid = order.EpayTdid
	topup.EpayPid = order.EpayPid
	topup.EpayTradeStatus = order.EpayTradeStatus
	topup.EpayNotifyPayload = order.EpayNotifyPayload
	return tx.Save(&topup).Error
}

// InsertSubscriptionTopUpPending creates a pending TopUp record for a subscription order.
// Called when a subscription order is created, so admins can see it in the TopUp list.
func InsertSubscriptionTopUpPending(order *SubscriptionOrder) error {
	if order == nil {
		return errors.New("order is nil")
	}
	topup := &TopUp{
		TenantId:      order.TenantId,
		UserId:        order.UserId,
		Amount:        0,
		Money:         order.Money,
		TradeNo:       order.TradeNo,
		PaymentMethod: order.PaymentMethod,
		CreateTime:    order.CreateTime,
		Status:        common.TopUpStatusPending,
		ClientIP:      order.ClientIP,
	}
	return DB.Create(topup).Error
}

// GetAllSubscriptionOrders returns paginated subscription orders with optional filters.
func GetAllSubscriptionOrders(tenantId int, pageInfo *common.PageInfo, keyword string, status string) (orders []*SubscriptionOrder, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&SubscriptionOrder{})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if keyword != "" {
		like := "%%" + keyword + "%%"
		query = query.Where("trade_no LIKE ?", like)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err = query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return orders, total, nil
}

func ExpireSubscriptionOrder(tradeNo string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Model(&SubscriptionOrder{}).
			Where("id = ? AND tenant_id = ?", order.Id, order.TenantId).
			Select("*").Updates(&order).Error
	})
}

// Admin bind (no payment). Creates a UserSubscription from a plan.
func AdminBindSubscription(tenantId int, userId int, planId int, sourceNote string) (string, error) {
	if userId <= 0 || planId <= 0 {
		return "", errors.New("invalid userId or planId")
	}
	plan, err := GetSubscriptionPlanById(tenantId, planId)
	if err != nil {
		return "", err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		_, err := CreateUserSubscriptionFromPlanTx(tx, tenantId, userId, plan, "admin")
		return err
	})
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(plan.UpgradeGroup) != "" {
		_ = UpdateUserGroupCache(userId, plan.UpgradeGroup)
		return fmt.Sprintf("用户分组将升级到 %s", plan.UpgradeGroup), nil
	}
	return "", nil
}

// ActivateUserSubscription activates an inactive subscription, setting StartTime/EndTime from now.
func ActivateUserSubscription(tenantId int, userId int, subscriptionId int) error {
	if tenantId <= 0 || userId <= 0 || subscriptionId <= 0 {
		return errors.New("invalid tenantId/userId/subscriptionId")
	}
	var upgradeGroup string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("id = ? AND user_id = ? AND tenant_id = ?", subscriptionId, userId, tenantId).
			First(&sub).Error; err != nil {
			return errors.New("订阅不存在")
		}
		if sub.Status != UserSubscriptionStatusInactive {
			return errors.New("该订阅不是待激活状态")
		}
		plan, err := GetSubscriptionPlanById(tenantId, sub.PlanId)
		if err != nil {
			return fmt.Errorf("获取套餐信息失败: %w", err)
		}
		nowUnix := GetDBTimestamp()
		now := time.Unix(nowUnix, 0)
		endUnix, err := calcPlanEndTime(now, plan)
		if err != nil {
			return err
		}
		resetBase := now
		nextReset := calcNextResetTime(resetBase, plan, endUnix)
		lastReset := int64(0)
		if nextReset > 0 {
			lastReset = now.Unix()
		}
		// Handle group upgrade at activation time
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		prevGroup := ""
		if upgradeGroup != "" {
			currentGroup, err := getUserGroupByIdTx(tx, tenantId, userId)
			if err != nil {
				return err
			}
			if currentGroup != upgradeGroup {
				prevGroup = currentGroup
				if err := tx.Model(&User{}).
					Where("id = ? AND tenant_id = ?", userId, tenantId).
					Update("group", upgradeGroup).Error; err != nil {
					return err
				}
			}
		}
		updates := map[string]interface{}{
			"status":          UserSubscriptionStatusActive,
			"start_time":      now.Unix(),
			"end_time":        endUnix,
			"last_reset_time": lastReset,
			"next_reset_time": nextReset,
			"prev_user_group": prevGroup,
			"updated_at":      common.GetTimestamp(),
		}
		return tx.Model(&UserSubscription{}).
			Where("id = ? AND tenant_id = ?", subscriptionId, tenantId).
			Updates(updates).Error
	})
	if err != nil {
		return err
	}
	if upgradeGroup != "" {
		_ = UpdateUserGroupCache(userId, upgradeGroup)
	}
	return nil
}

// GetAllActiveUserSubscriptions returns all active subscriptions for a user.
func GetAllActiveUserSubscriptions(tenantId int, userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	query := DB.Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	var subs []UserSubscription
	err := query.Order("end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

// HasActiveUserSubscription returns whether the user has any active subscription.
// This is a lightweight existence check to avoid heavy pre-consume transactions.
func HasActiveUserSubscription(tenantId int, userId int) (bool, error) {
	if userId <= 0 {
		return false, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	query := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetAllUserSubscriptions returns all subscriptions (active and expired) for a user.
func GetAllUserSubscriptions(tenantId int, userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	query := DB.Where("user_id = ?", userId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	var subs []UserSubscription
	err := query.Order("CASE WHEN status = 'inactive' THEN 0 ELSE 1 END, end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

func buildSubscriptionSummaries(subs []UserSubscription) []SubscriptionSummary {
	if len(subs) == 0 {
		return []SubscriptionSummary{}
	}
	result := make([]SubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		result = append(result, SubscriptionSummary{
			Subscription: &subCopy,
		})
	}
	return result
}

// AdminInvalidateUserSubscription marks a user subscription as cancelled and ends it immediately.
func AdminInvalidateUserSubscription(tenantId int, userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("id = ?", userSubscriptionId)
		if tenantId > 0 {
			query = query.Where("tenant_id = ?", tenantId)
		}
		var sub UserSubscription
		if err := query.First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		if err := tx.Model(&sub).Updates(map[string]interface{}{
			"status":     "cancelled",
			"end_time":   now,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" && userId > 0 {
		_ = UpdateUserGroupCache(userId, cacheGroup)
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(tenantId int, userSubscriptionId int) (string, error) {
	if tenantId <= 0 || userSubscriptionId <= 0 {
		return "", errors.New("tenantId 和 userSubscriptionId 不能为空")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("id = ? AND tenant_id = ?", userSubscriptionId, tenantId).
			First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		if err := tx.Where("id = ? AND tenant_id = ?", userSubscriptionId, tenantId).Delete(&UserSubscription{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if cacheGroup != "" && userId > 0 {
		_ = UpdateUserGroupCache(userId, cacheGroup)
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

type SubscriptionPreConsumeResult struct {
	UserSubscriptionId int
	PreConsumed        int64
	AmountTotal        int64
	AmountUsedBefore   int64
	AmountUsedAfter    int64
	// Shortfall is the amount that couldn't be covered by subscription quota.
	// When Shortfall > 0, the caller should consume the shortfall from wallet.
	Shortfall int64
}

// ExpireDueSubscriptions marks expired subscriptions and handles group downgrade.
// tenantId<=0 时按"全租户扫描"语义运行（定时任务场景），显式走 WithTenantBypass。
func ExpireDueSubscriptions(tenantId int, limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var query *gorm.DB
	if tenantId > 0 {
		query = DB.Where("tenant_id = ? AND status = ? AND end_time > 0 AND end_time <= ?", tenantId, "active", now)
	} else {
		query = WithTenantBypass(DB).Where("status = ? AND end_time > 0 AND end_time <= ?", "active", now)
	}
	var subs []UserSubscription
	if err := query.Order("end_time asc, id asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	expiredCount := 0
	// 记录每个 userId 对应的 tenantId（用户归属租户唯一）
	userTenant := make(map[int]int, len(subs))
	for _, sub := range subs {
		if sub.UserId > 0 && sub.TenantId > 0 {
			userTenant[sub.UserId] = sub.TenantId
		}
	}
	for userId, uTenantId := range userTenant {
		cacheGroup := ""
		err := DB.Transaction(func(tx *gorm.DB) error {
			res := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND tenant_id = ? AND status = ? AND end_time > 0 AND end_time <= ?",
					userId, uTenantId, "active", now).
				Updates(map[string]interface{}{
					"status":     "expired",
					"updated_at": common.GetTimestamp(),
				})
			if res.Error != nil {
				return res.Error
			}
			expiredCount += int(res.RowsAffected)

			// If there's an active upgraded subscription, keep current group.
			var activeSub UserSubscription
			activeQuery := tx.Where("user_id = ? AND tenant_id = ? AND status = ? AND end_time > ? AND upgrade_group <> ''",
				userId, uTenantId, "active", now).
				Order("end_time desc, id desc").
				Limit(1).
				Find(&activeSub)
			if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
				return nil
			}

			// No active upgraded subscription, downgrade to previous group if needed.
			var lastExpired UserSubscription
			expiredQuery := tx.Where("user_id = ? AND tenant_id = ? AND status = ? AND upgrade_group <> ''",
				userId, uTenantId, "expired").
				Order("end_time desc, id desc").
				Limit(1).
				Find(&lastExpired)
			if expiredQuery.Error != nil || expiredQuery.RowsAffected == 0 {
				return nil
			}
			upgradeGroup := strings.TrimSpace(lastExpired.UpgradeGroup)
			prevGroup := strings.TrimSpace(lastExpired.PrevUserGroup)
			if upgradeGroup == "" || prevGroup == "" {
				return nil
			}
			currentGroup, err := getUserGroupByIdTx(tx, uTenantId, userId)
			if err != nil {
				return err
			}
			if currentGroup != upgradeGroup || currentGroup == prevGroup {
				return nil
			}
			if err := tx.Model(&User{}).
				Where("id = ? AND tenant_id = ?", userId, uTenantId).
				Update("group", prevGroup).Error; err != nil {
				return err
			}
			cacheGroup = prevGroup
			return nil
		})
		if err != nil {
			return expiredCount, err
		}
		if cacheGroup != "" {
			_ = UpdateUserGroupCache(userId, cacheGroup)
		}
	}
	return expiredCount, nil
}

// SubscriptionPreConsumeRecord stores idempotent pre-consume operations per request.
type SubscriptionPreConsumeRecord struct {
	Id                 int    `json:"id"`
	TenantId           int    `json:"tenant_id" gorm:"index;default:1"`
	RequestId          string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"index"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index"`
	PreConsumed        int64  `json:"pre_consumed" gorm:"type:bigint;not null;default:0"`
	Status             string `json:"status" gorm:"type:varchar(32);index"` // consumed/refunded
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint;index"`
}

func (r *SubscriptionPreConsumeRecord) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	r.CreatedAt = now
	r.UpdatedAt = now
	return nil
}

func (r *SubscriptionPreConsumeRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = common.GetTimestamp()
	return nil
}

func maybeResetUserSubscriptionWithPlanTx(tx *gorm.DB, sub *UserSubscription, plan *SubscriptionPlan, now int64) error {
	if tx == nil || sub == nil || plan == nil {
		return errors.New("invalid reset args")
	}
	if sub.NextResetTime > 0 && sub.NextResetTime > now {
		return nil
	}
	if NormalizeResetPeriod(plan.QuotaResetPeriod) == SubscriptionResetNever {
		return nil
	}
	baseUnix := sub.LastResetTime
	if baseUnix <= 0 {
		baseUnix = sub.StartTime
	}
	base := time.Unix(baseUnix, 0)
	next := calcNextResetTime(base, plan, sub.EndTime)
	advanced := false
	for next > 0 && next <= now {
		advanced = true
		base = time.Unix(next, 0)
		next = calcNextResetTime(base, plan, sub.EndTime)
	}
	if !advanced {
		if sub.NextResetTime == 0 && next > 0 {
			return tx.Model(sub).Updates(map[string]interface{}{
				"last_reset_time": base.Unix(),
				"next_reset_time": next,
			}).Error
		}
		return nil
	}
	return tx.Model(sub).Updates(map[string]interface{}{
		"amount_used":     0,
		"last_reset_time": base.Unix(),
		"next_reset_time": next,
	}).Error
}

// ReorderSubscriptionsWithPreferred moves the subscription with the given ID to the front
// of the slice, keeping the relative order of the remaining elements. No-op if preferredSubId <= 0,
// if len(subs) <= 1, or if the ID is not found.
func ReorderSubscriptionsWithPreferred(subs []UserSubscription, preferredSubId int) {
	if preferredSubId <= 0 || len(subs) <= 1 {
		return
	}
	for i, s := range subs {
		if s.Id == preferredSubId {
			if i > 0 {
				preferred := subs[i]
				copy(subs[1:i+1], subs[:i])
				subs[0] = preferred
			}
			break
		}
	}
}

// PreConsumeUserSubscription pre-consumes from any active subscription total quota.
// If preferredSubId > 0, it tries that subscription first before falling back to the default order.
func PreConsumeUserSubscription(tenantId int, requestId string, userId int, modelName string, quotaType int, amount int64, preferredSubId int) (*SubscriptionPreConsumeResult, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	if strings.TrimSpace(requestId) == "" {
		return nil, errors.New("requestId is empty")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be > 0")
	}
	now := GetDBTimestamp()

	returnValue := &SubscriptionPreConsumeResult{}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing SubscriptionPreConsumeRecord
		query := tx.Where("request_id = ?", requestId).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.Status == "refunded" {
				return errors.New("subscription pre-consume already refunded")
			}
			var sub UserSubscription
			if err := tx.Where("id = ?", existing.UserSubscriptionId).First(&sub).Error; err != nil {
				return err
			}
			returnValue.UserSubscriptionId = sub.Id
			returnValue.PreConsumed = existing.PreConsumed
			returnValue.AmountTotal = sub.AmountTotal
			returnValue.AmountUsedBefore = sub.AmountUsed
			returnValue.AmountUsedAfter = sub.AmountUsed
			return nil
		}

		subsQuery := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now)
		if tenantId > 0 {
			subsQuery = subsQuery.Where("tenant_id = ?", tenantId)
		}
		var subs []UserSubscription
		if err := subsQuery.Order("end_time asc, id asc").
			Find(&subs).Error; err != nil {
			return errors.New("no active subscription")
		}
		if len(subs) == 0 {
			return errors.New("no active subscription")
		}
		ReorderSubscriptionsWithPreferred(subs, preferredSubId)
		for _, candidate := range subs {
			sub := candidate
			plan, err := getSubscriptionPlanByIdTx(tx, tenantId, sub.PlanId)
			if err != nil {
				return err
			}
			if err := maybeResetUserSubscriptionWithPlanTx(tx, &sub, plan, now); err != nil {
				return err
			}
			usedBefore := sub.AmountUsed

			// Skip subscriptions with no remaining quota
			if sub.AmountTotal > 0 {
				remain := sub.AmountTotal - usedBefore
				if remain <= 0 {
					continue
				}
			}
			// Consume full amount (may temporarily exceed AmountTotal; PostConsume adjusts back)
			actualConsume := amount

			record := &SubscriptionPreConsumeRecord{
				RequestId:          requestId,
				UserId:             userId,
				UserSubscriptionId: sub.Id,
				PreConsumed:        actualConsume,
				Status:             "consumed",
			}
			if err := tx.Create(record).Error; err != nil {
				var dup SubscriptionPreConsumeRecord
				if err2 := tx.Where("request_id = ?", requestId).First(&dup).Error; err2 == nil {
					if dup.Status == "refunded" {
						return errors.New("subscription pre-consume already refunded")
					}
					returnValue.UserSubscriptionId = sub.Id
					returnValue.PreConsumed = dup.PreConsumed
					returnValue.AmountTotal = sub.AmountTotal
					returnValue.AmountUsedBefore = sub.AmountUsed
					returnValue.AmountUsedAfter = sub.AmountUsed
					return nil
				}
				return err
			}
			newUsed := sub.AmountUsed + actualConsume
			if err := tx.Model(&sub).Update("amount_used", newUsed).Error; err != nil {
				return err
			}
			returnValue.UserSubscriptionId = sub.Id
			returnValue.PreConsumed = actualConsume
			returnValue.AmountTotal = sub.AmountTotal
			returnValue.AmountUsedBefore = usedBefore
			returnValue.AmountUsedAfter = newUsed
			returnValue.Shortfall = 0
			return nil
		}
		return fmt.Errorf("subscription quota insufficient, need=%d", amount)
	})
	if err != nil {
		return nil, err
	}
	return returnValue, nil
}

// RefundSubscriptionPreConsume is idempotent and refunds pre-consumed subscription quota by requestId.
func RefundSubscriptionPreConsume(requestId string) error {
	if strings.TrimSpace(requestId) == "" {
		return errors.New("requestId is empty")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record SubscriptionPreConsumeRecord
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("request_id = ?", requestId).First(&record).Error; err != nil {
			return err
		}
		if record.Status == "refunded" {
			return nil
		}
		if record.PreConsumed <= 0 {
			record.Status = "refunded"
			return tx.Save(&record).Error
		}
		if err := PostConsumeUserSubscriptionDelta(record.UserSubscriptionId, -record.PreConsumed); err != nil {
			return err
		}
		record.Status = "refunded"
		return tx.Save(&record).Error
	})
}

// ResetDueSubscriptions resets subscriptions whose next_reset_time has passed.
// ResetDueSubscriptions 重置到期自动续期的订阅配额。
// tenantId<=0 表示定时任务场景全租户扫描，显式 bypass。
func ResetDueSubscriptions(tenantId int, limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var query *gorm.DB
	if tenantId > 0 {
		query = DB.Where("tenant_id = ? AND next_reset_time > 0 AND next_reset_time <= ? AND status = ?", tenantId, now, "active")
	} else {
		query = WithTenantBypass(DB).Where("next_reset_time > 0 AND next_reset_time <= ? AND status = ?", now, "active")
	}
	var subs []UserSubscription
	if err := query.Order("next_reset_time asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	resetCount := 0
	for _, sub := range subs {
		subCopy := sub
		plan, err := getSubscriptionPlanByIdTx(nil, tenantId, sub.PlanId)
		if err != nil || plan == nil {
			continue
		}
		err = DB.Transaction(func(tx *gorm.DB) error {
			var locked UserSubscription
			if err := tx.Set("gorm:query_option", "FOR UPDATE").
				Where("id = ? AND next_reset_time > 0 AND next_reset_time <= ?", subCopy.Id, now).
				First(&locked).Error; err != nil {
				return nil
			}
			if err := maybeResetUserSubscriptionWithPlanTx(tx, &locked, plan, now); err != nil {
				return err
			}
			resetCount++
			return nil
		})
		if err != nil {
			return resetCount, err
		}
	}
	return resetCount, nil
}

// CleanupSubscriptionPreConsumeRecords removes old idempotency records to keep table small.
// tenantId<=0 表示定时任务场景全租户清理，显式 bypass guardrail。
func CleanupSubscriptionPreConsumeRecords(tenantId int, olderThanSeconds int64) (int64, error) {
	if olderThanSeconds <= 0 {
		olderThanSeconds = 7 * 24 * 3600
	}
	cutoff := GetDBTimestamp() - olderThanSeconds
	var query *gorm.DB
	if tenantId > 0 {
		query = DB.Where("tenant_id = ? AND updated_at < ?", tenantId, cutoff)
	} else {
		query = WithTenantBypass(DB).Where("updated_at < ?", cutoff)
	}
	res := query.Delete(&SubscriptionPreConsumeRecord{})
	return res.RowsAffected, res.Error
}

type SubscriptionPlanInfo struct {
	PlanId    int
	PlanTitle string
}

func GetSubscriptionPlanInfoByUserSubscriptionId(tenantId int, userSubscriptionId int) (*SubscriptionPlanInfo, error) {
	if userSubscriptionId <= 0 {
		return nil, errors.New("invalid userSubscriptionId")
	}
	cacheKey := fmt.Sprintf("sub:%d", userSubscriptionId)
	if cached, found, err := getSubscriptionPlanInfoCache().Get(cacheKey); err == nil && found {
		return &cached, nil
	}
	query := DB.Where("id = ?", userSubscriptionId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	var sub UserSubscription
	if err := query.First(&sub).Error; err != nil {
		return nil, err
	}
	plan, err := getSubscriptionPlanByIdTx(nil, tenantId, sub.PlanId)
	if err != nil {
		return nil, err
	}
	info := &SubscriptionPlanInfo{
		PlanId:    sub.PlanId,
		PlanTitle: plan.Title,
	}
	_ = getSubscriptionPlanInfoCache().SetWithTTL(cacheKey, *info, subscriptionPlanInfoCacheTTL())
	return info, nil
}

// Update subscription used amount by delta (positive consume more, negative refund).
func PostConsumeUserSubscriptionDelta(userSubscriptionId int, delta int64) error {
	if userSubscriptionId <= 0 {
		return errors.New("invalid userSubscriptionId")
	}
	if delta == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("id = ?", userSubscriptionId).
			First(&sub).Error; err != nil {
			return err
		}
		newUsed := sub.AmountUsed + delta
		if newUsed < 0 {
			newUsed = 0
		}
		return tx.Model(&sub).Update("amount_used", newUsed).Error
	})
}

// GetAllSubscriptionOrdersWithUser returns paginated subscription orders with LEFT JOIN to get username.
func GetAllSubscriptionOrdersWithUser(tenantId int, pageInfo *common.PageInfo, keyword string, status string) ([]SubscriptionOrderWithUser, int64, error) {
	var results []SubscriptionOrderWithUser
	var total int64

	orderTable := "subscription_orders"
	userTable := "users"
	usernameCol := "users.username"
	tradeNoCol := "subscription_orders.trade_no"
	statusCol := "subscription_orders.status"

	query := DB.Table(orderTable).
		Select(orderTable + ".*, " + usernameCol + " AS username").
		Joins("LEFT JOIN " + userTable + " ON " + orderTable + ".user_id = " + userTable + ".id")

	if tenantId > 0 {
		query = query.Where("subscription_orders.tenant_id = ?", tenantId)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where(tradeNoCol+" LIKE ? OR "+usernameCol+" LIKE ?", like, like)
	}
	if status != "" {
		query = query.Where(statusCol+" = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order(orderTable + ".id desc").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&results).Error; err != nil {
		return nil, 0, err
	}

	return results, total, nil
}

// GetSubscriptionPlansByIds fetches plans by IDs in one DB call, using cache where available.
// Returns a map of plan_id → *SubscriptionPlan.
func GetSubscriptionPlansByIds(tenantId int, ids []int) (map[int]*SubscriptionPlan, error) {
	if len(ids) == 0 {
		return map[int]*SubscriptionPlan{}, nil
	}
	unique := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		if id > 0 {
			unique[id] = struct{}{}
		}
	}
	result := make(map[int]*SubscriptionPlan, len(unique))
	missing := make([]int, 0, len(unique))
	for id := range unique {
		key := subscriptionPlanCacheKey(tenantId, id)
		if cached, found, err := getSubscriptionPlanCache().Get(key); err == nil && found {
			cp := cached
			result[id] = &cp
		} else {
			missing = append(missing, id)
		}
	}
	if len(missing) == 0 {
		return result, nil
	}
	query := DB.Where("id IN ?", missing)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	var plans []SubscriptionPlan
	if err := query.Find(&plans).Error; err != nil {
		return nil, err
	}
	for i := range plans {
		p := plans[i]
		result[p.Id] = &p
		key := subscriptionPlanCacheKey(tenantId, p.Id)
		_ = getSubscriptionPlanCache().SetWithTTL(key, p, subscriptionPlanCacheTTL())
	}
	return result, nil
}

// DeleteSubscriptionOrder hard-deletes a subscription order by trade_no.
// trade_no 全局唯一，允许 bypass guardrail 做跨租户唯一索引删除。
func DeleteSubscriptionOrder(tradeNo string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	result := WithTenantBypass(DB).Where("trade_no = ?", tradeNo).Delete(&SubscriptionOrder{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSubscriptionOrderNotFound
	}
	return nil
}
