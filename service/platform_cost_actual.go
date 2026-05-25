package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type PlatformCostSurcharges struct {
	WebSearchQuota           int
	ClaudeWebSearchQuota     int
	FileSearchQuota          int
	ImageGenerationCallQuota int
	AudioInputQuota          int
}

func ComputePlatformCostActualText(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, pd types.PriceData, usage *dto.Usage) int {
	if usage == nil {
		if relayInfo == nil {
			return 0
		}
		est := relayInfo.GetEstimatePromptTokens()
		usage = &dto.Usage{PromptTokens: est, CompletionTokens: 0, TotalTokens: est}
	}
	modelName := ""
	if relayInfo != nil {
		modelName = relayInfo.OriginModelName
	}
	surcharges := resolvePlatformCostSurcharges(ctx, relayInfo, pd, usage)
	return computePlatformCostActualWithSurcharges(pd, usage, relayInfo, modelName, surcharges)
}

func ComputePlatformCostActualRealtime(relayInfo *relaycommon.RelayInfo, usage *dto.RealtimeUsage) int {
	if relayInfo == nil || usage == nil {
		return 0
	}
	pd := relayInfo.PriceData
	channelRatio := pd.PlatformCostChannelRatio
	if channelRatio <= 0 {
		channelRatio = 1.0
	}
	info := QuotaInfo{
		InputDetails: TokenDetails{
			TextTokens:  usage.InputTokenDetails.TextTokens,
			AudioTokens: usage.InputTokenDetails.AudioTokens,
		},
		OutputDetails: TokenDetails{
			TextTokens:  usage.OutputTokenDetails.TextTokens,
			AudioTokens: usage.OutputTokenDetails.AudioTokens,
		},
		ModelName:  relayInfo.OriginModelName,
		UsePrice:   pd.UsePrice,
		ModelPrice: pd.PlatformCostModelPrice,
		ModelRatio: pd.PlatformCostModelRatio,
		GroupRatio: 1.0,
	}
	base := calculateAudioQuota(info)
	if base <= 0 {
		return 0
	}
	q := decimal.NewFromInt(int64(base)).Mul(decimal.NewFromFloat(channelRatio))
	for _, r := range pd.PlatformCostOtherRatios {
		q = q.Mul(decimal.NewFromFloat(r))
	}
	result := int(q.Round(0).IntPart())
	if result == 0 && (pd.PlatformCostModelRatio > 0 || pd.PlatformCostModelPrice > 0) {
		return 1
	}
	return result
}

func resolvePlatformCostSurcharges(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, pd types.PriceData, usage *dto.Usage) PlatformCostSurcharges {
	var s PlatformCostSurcharges
	dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	modelName := ""
	if relayInfo != nil {
		modelName = relayInfo.OriginModelName
	}

	if relayInfo != nil && relayInfo.ResponsesUsageInfo != nil {
		if ws, ok := relayInfo.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview]; ok && ws.CallCount > 0 {
			price := operation_setting.GetWebSearchPricePerThousand(modelName, ws.SearchContextSize)
			q := decimal.NewFromFloat(price).Mul(decimal.NewFromInt(int64(ws.CallCount))).Div(decimal.NewFromInt(1000)).Mul(dQuotaPerUnit)
			s.WebSearchQuota = int(q.Round(0).IntPart())
		}
		if fs, ok := relayInfo.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch]; ok && fs.CallCount > 0 {
			price := operation_setting.GetFileSearchPricePerThousand()
			q := decimal.NewFromFloat(price).Mul(decimal.NewFromInt(int64(fs.CallCount))).Div(decimal.NewFromInt(1000)).Mul(dQuotaPerUnit)
			s.FileSearchQuota = int(q.Round(0).IntPart())
		}
	} else if strings.HasSuffix(modelName, "search-preview") && ctx != nil {
		size := ctx.GetString("chat_completion_web_search_context_size")
		if size == "" {
			size = "medium"
		}
		price := operation_setting.GetWebSearchPricePerThousand(modelName, size)
		q := decimal.NewFromFloat(price).Div(decimal.NewFromInt(1000)).Mul(dQuotaPerUnit)
		s.WebSearchQuota = int(q.Round(0).IntPart())
	}

	if ctx != nil {
		if n := ctx.GetInt("claude_web_search_requests"); n > 0 {
			price := operation_setting.GetClaudeWebSearchPricePerThousand()
			q := decimal.NewFromFloat(price).Div(decimal.NewFromInt(1000)).Mul(dQuotaPerUnit).Mul(decimal.NewFromInt(int64(n)))
			s.ClaudeWebSearchQuota = int(q.Round(0).IntPart())
		}
		if ctx.GetBool("image_generation_call") {
			price := operation_setting.GetGPTImage1PriceOnceCall(ctx.GetString("image_generation_call_quality"), ctx.GetString("image_generation_call_size"))
			q := decimal.NewFromFloat(price).Mul(dQuotaPerUnit)
			s.ImageGenerationCallQuota = int(q.Round(0).IntPart())
		}
	}

	if usage != nil && usage.PromptTokensDetails.AudioTokens > 0 && !pd.UsePrice {
		price := operation_setting.GetGeminiInputAudioPricePerMillionTokens(modelName)
		if price > 0 {
			q := decimal.NewFromFloat(price).
				Div(decimal.NewFromInt(1_000_000)).
				Mul(decimal.NewFromInt(int64(usage.PromptTokensDetails.AudioTokens))).
				Mul(dQuotaPerUnit)
			s.AudioInputQuota = int(q.Round(0).IntPart())
		}
	}
	return s
}

func computePlatformCostActualWithSurcharges(pd types.PriceData, usage *dto.Usage, relayInfo *relaycommon.RelayInfo, modelName string, s PlatformCostSurcharges) int {
	if usage == nil {
		return 0
	}
	dChannelRatio := decimal.NewFromFloat(pd.PlatformCostChannelRatio)
	if dChannelRatio.LessThanOrEqual(decimal.Zero) {
		dChannelRatio = decimal.NewFromInt(1)
	}

	var base decimal.Decimal
	if pd.UsePrice {
		base = decimal.NewFromFloat(pd.PlatformCostModelPrice).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Mul(dChannelRatio)
	} else {
		base = computePlatformCostTokenBase(pd, usage, relayInfo, modelName).Mul(decimal.NewFromFloat(pd.PlatformCostModelRatio)).Mul(dChannelRatio)
	}

	total := base.
		Add(decimal.NewFromInt(int64(s.WebSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.ClaudeWebSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.FileSearchQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.ImageGenerationCallQuota)).Mul(dChannelRatio)).
		Add(decimal.NewFromInt(int64(s.AudioInputQuota)).Mul(dChannelRatio))

	for _, r := range pd.PlatformCostOtherRatios {
		total = total.Mul(decimal.NewFromFloat(r))
	}

	result := int(total.Round(0).IntPart())
	// 平台成本绝不能为负：上游/计费配置异常时（例如 cache_tokens > prompt_tokens
	// 又恰好绕过了上面的 clamp）落库成负值会直接污染对账。落到这里说明数据已经
	// 异常，先按 0 处理再走下面 ==0 的兜底逻辑。
	if result < 0 {
		result = 0
	}
	if result == 0 {
		totalTokens := usage.PromptTokens + usage.CompletionTokens
		hasSurcharge := s.WebSearchQuota+s.ClaudeWebSearchQuota+s.FileSearchQuota+s.ImageGenerationCallQuota+s.AudioInputQuota > 0
		if totalTokens > 0 && (pd.PlatformCostModelRatio > 0 || pd.PlatformCostModelPrice > 0) {
			return 1
		}
		if hasSurcharge {
			return 1
		}
	}
	return result
}

func computePlatformCostTokenBase(pd types.PriceData, usage *dto.Usage, relayInfo *relaycommon.RelayInfo, modelName string) decimal.Decimal {
	semantic := "openai"
	if relayInfo != nil {
		semantic = usageSemanticFromUsage(relayInfo, usage)
	} else if usage != nil && usage.UsageSemantic != "" {
		semantic = usage.UsageSemantic
	}
	isAnthropic := semantic == "anthropic"
	isOpenRouterClaudeBilling := relayInfo != nil &&
		relayInfo.ChannelMeta != nil &&
		relayInfo.ChannelType == constant.ChannelTypeOpenRouter &&
		isAnthropic

	promptTokens := usage.PromptTokens
	cacheTokens := usage.PromptTokensDetails.CachedTokens
	cacheCreationTokens := usage.PromptTokensDetails.CachedCreationTokens
	if isOpenRouterClaudeBilling {
		promptTokens -= cacheTokens
		if cacheCreationTokens == 0 && pd.CacheCreationRatio != 1 && usage.Cost != 0 {
			isCustom := pd.UsePrice || hasCustomModelRatio(modelName, pd.PlatformCostModelRatio)
			if !isCustom {
				costPD := pd
				costPD.ModelRatio = pd.PlatformCostModelRatio
				maybe := CalcOpenRouterCacheCreateTokens(*usage, costPD)
				if maybe >= 0 && promptTokens >= maybe {
					cacheCreationTokens = maybe
				}
			}
		}
		promptTokens -= cacheCreationTokens
	}

	dPrompt := decimal.NewFromInt(int64(promptTokens))
	dCompletion := decimal.NewFromInt(int64(usage.CompletionTokens))
	dCache := decimal.NewFromInt(int64(cacheTokens))
	dCacheCreation := decimal.NewFromInt(int64(cacheCreationTokens))
	dCacheCreation5m := decimal.NewFromInt(int64(usage.ClaudeCacheCreation5mTokens))
	dCacheCreation1h := decimal.NewFromInt(int64(usage.ClaudeCacheCreation1hTokens))
	dImage := decimal.NewFromInt(int64(usage.PromptTokensDetails.ImageTokens))
	dAudio := decimal.NewFromInt(int64(usage.PromptTokensDetails.AudioTokens))

	baseTokens := dPrompt
	legacyClaudeDerived := isLegacyClaudeDerivedOpenAIUsage(relayInfo, usage)
	if !isAnthropic && !legacyClaudeDerived {
		// 与 service/text_quota.go 中一致：OpenAI 语义下扣减 cache/cache_creation
		// 时如果上游上报的缓存量超过 prompt_tokens，必须 clamp 到 baseTokens
		// 当前值，否则平台成本会落库成负数。
		if !dCache.IsZero() {
			baseTokens = baseTokens.Sub(decimal.Min(baseTokens, dCache))
		}
		if !dCacheCreation.IsZero() {
			baseTokens = baseTokens.Sub(decimal.Min(baseTokens, dCacheCreation))
		}
	}
	if !dImage.IsZero() {
		baseTokens = baseTokens.Sub(dImage)
	}
	audioSeparate := !dAudio.IsZero() && operation_setting.GetGeminiInputAudioPricePerMillionTokens(modelName) > 0
	if audioSeparate {
		baseTokens = baseTokens.Sub(dAudio)
	}

	var cacheCreationSubtotal decimal.Decimal
	hasSplit := usage.ClaudeCacheCreation5mTokens > 0 || usage.ClaudeCacheCreation1hTokens > 0
	if isAnthropic || legacyClaudeDerived {
		remaining := cacheCreationTokens - usage.ClaudeCacheCreation5mTokens - usage.ClaudeCacheCreation1hTokens
		if remaining < 0 {
			remaining = 0
		}
		cacheCreationSubtotal = decimal.NewFromInt(int64(remaining)).Mul(decimal.NewFromFloat(pd.CacheCreationRatio))
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation5m.Mul(decimal.NewFromFloat(pd.CacheCreation5mRatio)))
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation1h.Mul(decimal.NewFromFloat(pd.CacheCreation1hRatio)))
	} else if hasSplit {
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation5m.Mul(decimal.NewFromFloat(pd.CacheCreation5mRatio)))
		cacheCreationSubtotal = cacheCreationSubtotal.Add(dCacheCreation1h.Mul(decimal.NewFromFloat(pd.CacheCreation1hRatio)))
	} else {
		cacheCreationSubtotal = dCacheCreation.Mul(decimal.NewFromFloat(pd.CacheCreationRatio))
	}

	var audioInBase decimal.Decimal
	if !audioSeparate {
		audioInBase = dAudio.Mul(decimal.NewFromFloat(pd.AudioRatio))
	}

	return baseTokens.
		Add(dCache.Mul(decimal.NewFromFloat(pd.CacheRatio))).
		Add(cacheCreationSubtotal).
		Add(dImage.Mul(decimal.NewFromFloat(pd.ImageRatio))).
		Add(audioInBase).
		Add(dCompletion.Mul(decimal.NewFromFloat(pd.CompletionRatio)))
}
