package service

import (
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const (
	CacheBillingSemanticInclusive = "inclusive"
	CacheBillingSemanticExclusive = "exclusive"
)

func GetEffectiveCacheBillingMode(relayInfo *relaycommon.RelayInfo) dto.CacheBillingMode {
	if relayInfo == nil {
		return dto.CacheBillingModeAuto
	}
	mode := relayInfo.ChannelSetting.CacheBillingMode
	if mode == dto.CacheBillingModeInclusive || mode == dto.CacheBillingModeExclusive {
		return mode
	}
	return dto.CacheBillingModeAuto
}

func GetEffectiveCacheBillingSemantic(relayInfo *relaycommon.RelayInfo) string {
	mode := GetEffectiveCacheBillingMode(relayInfo)
	if mode == dto.CacheBillingModeInclusive {
		return CacheBillingSemanticInclusive
	}
	if mode == dto.CacheBillingModeExclusive {
		return CacheBillingSemanticExclusive
	}
	if relayInfo != nil && relayInfo.ChannelType == constant.ChannelTypeAnthropic {
		return CacheBillingSemanticExclusive
	}
	return CacheBillingSemanticInclusive
}

func ShouldSubtractCachedTokens(relayInfo *relaycommon.RelayInfo) bool {
	return GetEffectiveCacheBillingSemantic(relayInfo) == CacheBillingSemanticInclusive
}
