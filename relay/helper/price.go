package helper

import (
	"fmt"
	"math"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// https://docs.claude.com/en/docs/build-with-claude/prompt-caching#1-hour-cache-duration
const claudeCacheCreation1hMultiplier = 6 / 3.75

// HandleGroupRatio checks for "auto_group" in the context and updates the group ratio and relayInfo.UsingGroup if present
func HandleGroupRatio(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) types.GroupRatioInfo {
	groupRatioInfo := types.GroupRatioInfo{
		GroupRatio:        1.0, // default ratio
		GroupSpecialRatio: -1,
	}

	// check auto group
	autoGroup, exists := ctx.Get("auto_group")
	if exists {
		logger.LogDebug(ctx, fmt.Sprintf("final group: %s", autoGroup))
		relayInfo.UsingGroup = autoGroup.(string)
	}

	groupRatioMap := service.GetTenantGroupRatioMap(relayInfo.TenantId)
	groupGroupRatioMap := service.GetTenantGroupGroupRatioMap(relayInfo.TenantId)
	groupRatio, hasSpecial := service.GetTenantUserGroupRatioFromMaps(groupRatioMap, groupGroupRatioMap, relayInfo.UserGroup, relayInfo.UsingGroup)
	groupRatioInfo.GroupRatio = groupRatio
	if hasSpecial {
		groupRatioInfo.GroupSpecialRatio = groupRatio
		groupRatioInfo.GroupRatio = groupRatio
		groupRatioInfo.HasSpecialRatio = true
	}

	return groupRatioInfo
}

func ModelPriceHelper(c *gin.Context, info *relaycommon.RelayInfo, promptTokens int, meta *types.TokenCountMeta) (types.PriceData, error) {
	modelPrice, usePrice := ratio_setting.GetModelPrice(info.OriginModelName, false)

	groupRatioInfo := HandleGroupRatio(c, info)

	var preConsumedQuota int
	var preConsumedTokens int
	var modelRatio float64
	var completionRatio float64
	var cacheRatio float64
	var imageRatio float64
	var cacheCreationRatio float64
	var cacheCreationRatio5m float64
	var cacheCreationRatio1h float64
	var audioRatio float64
	var audioCompletionRatio float64
	var freeModel bool
	if !usePrice {
		preConsumedTokens = common.Max(promptTokens, common.PreConsumedQuota)
		if meta.MaxTokens != 0 {
			preConsumedTokens += meta.MaxTokens
		}
		var success bool
		var matchName string
		modelRatio, success, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
		if !success {
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !acceptUnsetRatio {
				return types.PriceData{}, fmt.Errorf("模型 %s 倍率或价格未配置，请联系管理员设置或开始自用模式；Model %s ratio or price not set, please set or start self-use mode", matchName, matchName)
			}
		}
		completionRatio = ratio_setting.GetCompletionRatio(info.OriginModelName)
		cacheRatio, _ = ratio_setting.GetCacheRatio(info.OriginModelName)
		cacheCreationRatio, _ = ratio_setting.GetCreateCacheRatio(info.OriginModelName)
		cacheCreationRatio5m = cacheCreationRatio
		// 固定1h和5min缓存写入价格的比例
		cacheCreationRatio1h = cacheCreationRatio * claudeCacheCreation1hMultiplier
		imageRatio, _ = ratio_setting.GetImageRatio(info.OriginModelName)
		audioRatio = ratio_setting.GetAudioRatio(info.OriginModelName)
		audioCompletionRatio = ratio_setting.GetAudioCompletionRatio(info.OriginModelName)
		ratio := modelRatio * groupRatioInfo.GroupRatio
		preConsumedQuota = int(float64(preConsumedTokens) * ratio)
	} else {
		if meta.ImagePriceRatio != 0 {
			modelPrice = modelPrice * meta.ImagePriceRatio
		}
		preConsumedQuota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
	}

	// check if free model pre-consume is disabled
	if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
		// if model price or ratio is 0, do not pre-consume quota
		if groupRatioInfo.GroupRatio == 0 {
			preConsumedQuota = 0
			freeModel = true
		} else if usePrice {
			if modelPrice == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		} else {
			if modelRatio == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		}
	}

	priceData := types.PriceData{
		FreeModel:            freeModel,
		ModelPrice:           modelPrice,
		ModelRatio:           modelRatio,
		OriginalModelRatio:   modelRatio,
		CompletionRatio:      completionRatio,
		GroupRatioInfo:       groupRatioInfo,
		UsePrice:             usePrice,
		CacheRatio:           cacheRatio,
		ImageRatio:           imageRatio,
		AudioRatio:           audioRatio,
		AudioCompletionRatio: audioCompletionRatio,
		CacheCreationRatio:   cacheCreationRatio,
		CacheCreation5mRatio: cacheCreationRatio5m,
		CacheCreation1hRatio: cacheCreationRatio1h,
		QuotaToPreConsume:    preConsumedQuota,
	}
	info.PriceData = priceData
	FillPlatformCostEstimate(c, info, preConsumedTokens)
	applyPlatformMarkup(c, info, &info.PriceData, true)
	priceData = info.PriceData

	if common.DebugEnabled {
		println(fmt.Sprintf("model_price_helper result: %s", priceData.ToSetting()))
	}
	return priceData, nil
}

// ApplyChannelBillingOverrides applies channel-level billing overrides
// (channel_ratio and model_ratio_override) from channel settings to the PriceData.
// It resets ModelRatio to OriginalModelRatio first to handle retry scenarios.
func ApplyChannelBillingOverrides(info *relaycommon.RelayInfo) {
	if info.ChannelMeta == nil {
		return
	}
	settings := info.ChannelMeta.ChannelSetting

	// 1. Reset ModelRatio to original (handles retry scenario)
	if info.PriceData.OriginalModelRatio > 0 {
		info.PriceData.ModelRatio = info.PriceData.OriginalModelRatio
	}

	// 2. Apply model-specific ratio override
	if settings.ModelRatioOverride != nil {
		if override, ok := settings.ModelRatioOverride[info.UpstreamModelName]; ok && override > 0 {
			info.PriceData.ModelRatio = override
		}
		// Also check the original model name
		if override, ok := settings.ModelRatioOverride[info.OriginModelName]; ok && override > 0 {
			info.PriceData.ModelRatio = override
		}
	}

	// 3. Apply channel ratio as an OtherRatio
	if settings.ChannelRatio > 0 && settings.ChannelRatio != 1.0 {
		info.PriceData.AddOtherRatio("channel_ratio", settings.ChannelRatio)
	}
	RefreshPlatformCostEstimate(nil, info)
}

// ModelPriceHelperPerCall 按次/按量计费的 PriceHelper (MJ、Task)
func ModelPriceHelperPerCall(c *gin.Context, info *relaycommon.RelayInfo) (types.PriceData, error) {
	groupRatioInfo := HandleGroupRatio(c, info)

	modelPrice, success := ratio_setting.GetModelPrice(info.OriginModelName, true)
	usePrice := success
	var modelRatio float64

	if !success {
		defaultPrice, ok := ratio_setting.GetDefaultModelPriceMap()[info.OriginModelName]
		if ok {
			modelPrice = defaultPrice
			usePrice = true
		} else {
			var ratioSuccess bool
			var matchName string
			modelRatio, ratioSuccess, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !ratioSuccess && !acceptUnsetRatio {
				return types.PriceData{}, fmt.Errorf("模型 %s 倍率或价格未配置，请联系管理员设置或开始自用模式；Model %s ratio or price not set, please set or start self-use mode", matchName, matchName)
			}
		}
	}

	var quota int
	freeModel := false

	if usePrice {
		quota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelPrice == 0 {
				quota = 0
				freeModel = true
			}
		}
	} else {
		// 按量计费：以模型倍率的一半作为预扣额度
		quota = int(modelRatio / 2 * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
		modelPrice = -1
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelRatio == 0 {
				quota = 0
				freeModel = true
			}
		}
	}

	priceData := types.PriceData{
		FreeModel:      freeModel,
		ModelPrice:     modelPrice,
		ModelRatio:     modelRatio,
		UsePrice:       usePrice,
		Quota:          quota,
		GroupRatioInfo: groupRatioInfo,
	}
	if !usePrice {
		priceData.OriginalModelRatio = modelRatio
	}
	info.PriceData = priceData
	FillPlatformCostPerCallEstimate(c, info)
	applyPlatformMarkup(c, info, &info.PriceData, false)
	priceData = info.PriceData
	return priceData, nil
}

func applyPlatformMarkup(c *gin.Context, info *relaycommon.RelayInfo, priceData *types.PriceData, usePreConsumed bool) {
	if info == nil || priceData == nil {
		return
	}
	// ChannelMeta 是 *RelayInfo 的匿名指针嵌入（见 relay_info.go），
	// 在各 handler 入口 InitChannelMeta 之前都是 nil。本函数会在
	// controller.Relay -> ModelPriceHelper 里被提前调用（pre-consume
	// 阶段），此时 ChannelMeta 尚未初始化，直接访问/回写 info.ChannelId
	// 会 nil deref。ChannelMeta 为 nil 时从 ctx 兜底取 channel id，不回写。
	var channelID int
	if info.ChannelMeta != nil {
		channelID = info.ChannelId
	}
	if channelID <= 0 && c != nil {
		channelID = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}
	if channelID <= 0 {
		info.PriceMarkupRatio = 1.0
		info.PriceMarkupSource = "none"
		return
	}
	if info.ChannelMeta != nil {
		info.ChannelId = channelID
	}

	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil {
		info.PriceMarkupRatio = 1.0
		info.PriceMarkupSource = "none"
		return
	}
	plan, _ := model.GetTenantPlan(info.TenantId)
	mk, src := service.EffectiveMarkup(ch, plan)
	if mk <= 0 {
		mk = 1.0
		src = "none"
	}
	if mk != 1.0 {
		if usePreConsumed {
			priceData.QuotaToPreConsume = int(math.Ceil(float64(priceData.QuotaToPreConsume) * mk))
		} else {
			priceData.Quota = int(math.Ceil(float64(priceData.Quota) * mk))
		}
		priceData.AddOtherRatio("platform_markup", mk)
	}
	info.PriceMarkupRatio = mk
	info.PriceMarkupSource = src
}

// EnforcePlatformChannelQuota rejects a request when the bound channel is
// platform-scoped and the tenant's projected usage would exceed their cap.
// Callers must invoke it only after the handler's PriceData has been filled.
//
// Checks against the "tenant real cost" portion of the projected quota —
// i.e. the value before applyPlatformMarkup lifted it. Keeps cap semantics
// decoupled from the tenant's user-facing markup choice; see
// TrackPlatformChannelUsageIfApplicable for the mirror on the settle side.
func EnforcePlatformChannelQuota(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info == nil || info.TenantId <= 0 {
		return nil
	}

	var channelID int
	if info.ChannelMeta != nil {
		channelID = info.ChannelId
	}
	if channelID <= 0 && c != nil {
		channelID = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}
	if channelID <= 0 {
		return nil
	}

	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil || ch.Scope != model.ChannelScopePlatform {
		return nil
	}

	projected := info.PriceData.PlatformCostQuotaToPreConsume
	if projected <= 0 {
		projected = info.PriceData.PlatformCostQuota
	}
	if projected <= 0 {
		logger.LogError(c, fmt.Sprintf("platform channel %d has zero platform cost estimate", channelID))
		return types.NewErrorWithStatusCode(
			fmt.Errorf("platform cost not configured for this channel"),
			types.ErrorCodeModelPriceError,
			http.StatusInternalServerError,
			types.ErrOptionWithSkipRetry(),
		)
	}

	if err := service.CheckTenantPlatformChannelQuota(info.TenantId, projected); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeTenantQuotaExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
	}
	return nil
}

func ContainPriceOrRatio(modelName string) bool {
	_, ok := ratio_setting.GetModelPrice(modelName, false)
	if ok {
		return true
	}
	_, ok, _ = ratio_setting.GetModelRatio(modelName)
	if ok {
		return true
	}
	return false
}
