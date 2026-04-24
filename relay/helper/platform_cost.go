package helper

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

func FillPlatformCostEstimate(c *gin.Context, info *relaycommon.RelayInfo, preConsumedTokens int) {
	if info == nil {
		return
	}
	ch := loadPlatformChannel(resolvePlatformCostChannelID(c, info))
	if ch == nil {
		clearPlatformCostEstimate(info)
		return
	}
	populatePlatformCostRates(info, ch)
	if info.PriceData.UsePrice {
		info.PriceData.PlatformCostQuotaToPreConsume = computePlatformCostQuotaForPerCall(&info.PriceData, 0)
		return
	}
	info.PriceData.PlatformCostQuotaToPreConsume = computePlatformCostQuotaForTokens(&info.PriceData, preConsumedTokens)
}

func FillPlatformCostPerCallEstimate(c *gin.Context, info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	ch := loadPlatformChannel(resolvePlatformCostChannelID(c, info))
	if ch == nil {
		clearPlatformCostEstimate(info)
		return
	}
	populatePlatformCostRates(info, ch)
	info.PriceData.PlatformCostQuota = computePlatformCostQuotaForPerCall(&info.PriceData, 0)
	info.PriceData.PlatformCostQuotaToPreConsume = info.PriceData.PlatformCostQuota
}

func RefreshPlatformCostEstimate(c *gin.Context, info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	if info.PriceData.Quota > 0 && info.PriceData.QuotaToPreConsume == 0 {
		FillPlatformCostPerCallEstimate(c, info)
		return
	}
	FillPlatformCostEstimate(c, info, estimatePlatformCostPreConsumeTokens(info))
}

func estimatePlatformCostPreConsumeTokens(info *relaycommon.RelayInfo) int {
	if info == nil {
		return 0
	}
	tokens := common.Max(info.GetEstimatePromptTokens(), common.PreConsumedQuota)
	if info.Request != nil {
		if meta := info.Request.GetTokenCountMeta(); meta != nil && meta.MaxTokens != 0 {
			tokens += meta.MaxTokens
		}
	}
	if tokens > 0 {
		return tokens
	}
	prevRatio := info.PriceData.PlatformCostModelRatio * info.PriceData.PlatformCostChannelRatio
	if prevRatio > 0 {
		return int(float64(info.PriceData.PlatformCostQuotaToPreConsume) / prevRatio)
	}
	return 0
}

func clearPlatformCostEstimate(info *relaycommon.RelayInfo) {
	info.PriceData.PlatformCostQuota = 0
	info.PriceData.PlatformCostQuotaToPreConsume = 0
	info.PriceData.PlatformCostModelRatio = 0
	info.PriceData.PlatformCostModelPrice = 0
	info.PriceData.PlatformCostChannelRatio = 0
	info.PriceData.PlatformCostOtherRatios = nil
}

func computePlatformCostQuotaForTokens(pd *types.PriceData, preConsumedTokens int) int {
	if pd == nil || preConsumedTokens <= 0 {
		return 0
	}
	ratio := pd.PlatformCostModelRatio * pd.PlatformCostChannelRatio
	for _, r := range pd.PlatformCostOtherRatios {
		ratio *= r
	}
	if ratio <= 0 {
		return 0
	}
	q := decimal.NewFromInt(int64(preConsumedTokens)).Mul(decimal.NewFromFloat(ratio))
	result := int(q.Round(0).IntPart())
	if result == 0 {
		return 1
	}
	return result
}

func computePlatformCostQuotaForPerCall(pd *types.PriceData, imageMultiplier float64) int {
	if pd == nil || pd.PlatformCostChannelRatio <= 0 {
		return 0
	}
	var q decimal.Decimal
	if pd.UsePrice {
		price := pd.PlatformCostModelPrice
		if imageMultiplier > 0 {
			price *= imageMultiplier
		}
		if price <= 0 {
			return 0
		}
		q = decimal.NewFromFloat(price).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	} else {
		if pd.PlatformCostModelRatio <= 0 {
			return 0
		}
		q = decimal.NewFromFloat(pd.PlatformCostModelRatio).Div(decimal.NewFromInt(2)).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	}
	q = q.Mul(decimal.NewFromFloat(pd.PlatformCostChannelRatio))
	for _, r := range pd.PlatformCostOtherRatios {
		q = q.Mul(decimal.NewFromFloat(r))
	}
	result := int(q.Round(0).IntPart())
	if result == 0 {
		return 1
	}
	return result
}

func resolvePlatformCostChannelID(c *gin.Context, info *relaycommon.RelayInfo) int {
	var id int
	if info != nil && info.ChannelMeta != nil {
		id = info.ChannelId
	}
	if id <= 0 && c != nil {
		id = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}
	return id
}

func loadPlatformChannel(channelID int) *model.Channel {
	if channelID <= 0 {
		return nil
	}
	ch, err := model.CacheGetChannel(channelID)
	if err != nil || ch == nil {
		common.SysError("platform_cost: failed to load channel")
		return nil
	}
	if ch.Scope != model.ChannelScopePlatform {
		return nil
	}
	return ch
}

func populatePlatformCostRates(info *relaycommon.RelayInfo, ch *model.Channel) {
	if info == nil || ch == nil {
		return
	}
	if info.PriceData.UsePrice {
		info.PriceData.PlatformCostModelPrice = info.PriceData.ModelPrice
	} else if info.PriceData.OriginalModelRatio > 0 {
		info.PriceData.PlatformCostModelRatio = info.PriceData.OriginalModelRatio
	} else if r, ok, _ := ratio_setting.GetModelRatio(info.OriginModelName); ok {
		info.PriceData.PlatformCostModelRatio = r
	}
	info.PriceData.PlatformCostChannelRatio = ch.ResolvePlatformCostRatio()
}
