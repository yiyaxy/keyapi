package service

import (
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/channel_stability"
)

const (
	ChannelStabilityStreamBoundaryEnabledKey      = "ChannelStabilityStreamBoundaryEnabled"
	ChannelStabilityErrorClassificationEnabledKey = "ChannelStabilityErrorClassificationEnabled"
	ChannelStabilityCooldownEnabledKey            = "ChannelStabilityCooldownEnabled"
	ChannelStabilityHealthScoreEnabledKey         = "ChannelStabilityHealthScoreEnabled"
	ChannelStabilityAffinityGovernanceEnabledKey  = "ChannelStabilityAffinityGovernanceEnabled"
)

func init() {
	model.ChannelCooldownEnabledForTenant = IsChannelStabilityCooldownEnabled
}

func IsChannelStabilityStreamBoundaryEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, ChannelStabilityStreamBoundaryEnabledKey, common.ChannelStabilityStreamBoundaryEnabled)
}

func IsChannelStabilityErrorClassificationEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, ChannelStabilityErrorClassificationEnabledKey, common.ChannelStabilityErrorClassificationEnabled)
}

func IsChannelStabilityCooldownEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, ChannelStabilityCooldownEnabledKey, common.ChannelStabilityCooldownEnabled)
}

func IsChannelStabilityHealthScoreEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, ChannelStabilityHealthScoreEnabledKey, common.ChannelStabilityHealthScoreEnabled)
}

func IsChannelStabilityAffinityGovernanceEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, ChannelStabilityAffinityGovernanceEnabledKey, common.ChannelStabilityAffinityGovernanceEnabled)
}

func GetFirstTokenTimeout(modelName string) time.Duration {
	cfg := channel_stability.Get()
	timeoutMs := firstTokenTimeoutMs(modelName, cfg.StreamBoundary)
	if timeoutMs <= 0 {
		timeoutMs = channel_stability.DefaultFirstTokenTimeoutMs
	}
	return time.Duration(timeoutMs) * time.Millisecond
}

func firstTokenTimeoutMs(modelName string, cfg channel_stability.StreamBoundaryConfig) int {
	normalizedModel := strings.ToLower(strings.TrimSpace(modelName))
	if normalizedModel != "" {
		if timeoutMs := lookupTimeoutOverride(normalizedModel, cfg.ModelTimeoutOverrides); timeoutMs > 0 {
			return timeoutMs
		}
		if timeoutMs := lookupModelFamilyTimeout(normalizedModel, cfg.ModelFamilyOverrides); timeoutMs > 0 {
			return timeoutMs
		}
	}
	if cfg.DefaultFirstTokenTimeoutMs > 0 {
		return cfg.DefaultFirstTokenTimeoutMs
	}
	return channel_stability.DefaultFirstTokenTimeoutMs
}

func lookupTimeoutOverride(modelName string, overrides map[string]int) int {
	for key, timeoutMs := range overrides {
		if strings.ToLower(strings.TrimSpace(key)) == modelName {
			return timeoutMs
		}
	}
	return 0
}

func lookupModelFamilyTimeout(modelName string, overrides map[string]int) int {
	normalized := make(map[string]int, len(overrides))
	keys := make([]string, 0, len(overrides))
	for key, timeoutMs := range overrides {
		key = strings.ToLower(strings.TrimSpace(key))
		if key != "" {
			normalized[key] = timeoutMs
			keys = append(keys, key)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		return len(keys[i]) > len(keys[j])
	})
	for _, key := range keys {
		if strings.HasPrefix(modelName, key) {
			return normalized[key]
		}
	}
	return 0
}

func GetChannelCooldownEscalationLimit() int {
	limit := channel_stability.Get().Cooldown.EscalationLimit
	if limit <= 0 {
		return channel_stability.DefaultCooldownEscalationLimit
	}
	return limit
}

func NextChannelCooldownDuration(count int) time.Duration {
	cfg := channel_stability.Get().Cooldown
	baseMs := cfg.BaseDurationMs
	if baseMs <= 0 {
		baseMs = channel_stability.DefaultCooldownBaseDurationMs
	}
	maxMs := cfg.MaxDurationMs
	if maxMs <= 0 {
		maxMs = channel_stability.DefaultCooldownMaxDurationMs
	}
	if count < 0 {
		count = 0
	}
	durationMs := baseMs
	for i := 0; i < count && durationMs < maxMs; i++ {
		durationMs *= 2
	}
	if durationMs > maxMs {
		durationMs = maxMs
	}
	return time.Duration(durationMs) * time.Millisecond
}
