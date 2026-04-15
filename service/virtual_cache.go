package service

import (
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func ApplyVirtualCache(relayInfo *relaycommon.RelayInfo, usage *dto.Usage) {
	if relayInfo == nil || relayInfo.ChannelMeta == nil {
		return
	}
	setting := relayInfo.ChannelMeta.ChannelSetting
	if !setting.VirtualCacheEnabled {
		return
	}
	if usage == nil {
		return
	}
	// Real cache has priority
	if usage.PromptTokensDetails.CachedTokens > 0 {
		return
	}

	hitRate := setting.VirtualCacheHitRate
	if hitRate == 0 {
		hitRate = 0.5
	}
	jitter := setting.VirtualCacheJitter
	if jitter == 0 {
		jitter = 0.05
	}

	r := rand.New(rand.NewSource(time.Now().UnixNano() + int64(relayInfo.ChannelId)))
	u := r.Float64()
	effective := hitRate + (u*2-1)*jitter
	if effective < 0 {
		effective = 0
	} else if effective > 1 {
		effective = 1
	}

	promptTokens := usage.PromptTokens
	if promptTokens <= 0 {
		return
	}
	virtualTokens := int(float64(promptTokens) * effective)
	if virtualTokens < 0 {
		virtualTokens = 0
	} else if virtualTokens > promptTokens {
		virtualTokens = promptTokens
	}

	usage.PromptTokensDetails.CachedTokens = virtualTokens
	relayInfo.VirtualCacheTokens = virtualTokens
	relayInfo.VirtualCacheHitRate = effective
}
