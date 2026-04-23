package service

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
)

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		TrackPlatformChannelUsageIfApplicable(relayInfo, actualQuota)
		return nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		if err := PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true); err != nil {
			return err
		}
	}
	TrackPlatformChannelUsageIfApplicable(relayInfo, actualQuota)
	return nil
}

// TrackPlatformChannelUsageIfApplicable records actual settled usage against
// the tenant's platform-channel quota accumulator. Best-effort only.
//
// Cap 语义是"租户对平台的真实成本上限"——不应被租户自设的 platform_markup
// 放大（否则租户吸收 channel 折扣时 cap 会按虚高的用户账单扣）。因此累加
// 的是 actualQuota / markup，即 markup 乘入之前的值。
func TrackPlatformChannelUsageIfApplicable(relayInfo *relaycommon.RelayInfo, actualQuota int) {
	if relayInfo == nil || relayInfo.TenantId <= 0 || actualQuota <= 0 {
		return
	}
	channelID := relayInfo.ChannelId
	if channelID <= 0 {
		return
	}
	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		return
	}
	tenantCost := StripMarkup(actualQuota, relayInfo.PriceMarkupRatio)
	if tenantCost <= 0 {
		return
	}
	IncrementTenantPlatformChannelUsed(relayInfo.TenantId, tenantCost)
}

// StripMarkup reverses the markup multiplication applied in
// applyPlatformMarkup, returning the "tenant-vs-platform real cost" portion
// of a settled quota. Used by both pre-consume enforcement and settle-time
// platform_quota_cap accounting so cap stays decoupled from the tenant's
// user-facing markup choice.
func StripMarkup(quota int, markup float64) int {
	if quota <= 0 {
		return 0
	}
	if markup <= 0 || markup == 1.0 {
		return quota
	}
	return int(math.Ceil(float64(quota) / markup))
}
