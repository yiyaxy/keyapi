package service

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

type TenantModelRequestRateLimitConfig struct {
	Enabled         bool
	DurationMinutes int
	TotalCount      int
	SuccessCount    int
	GroupLimits     map[string][2]int
}

func clampTenantInt(tenantValue int, platformValue int, zeroPlatformMeansUnlimited bool) int {
	if zeroPlatformMeansUnlimited {
		switch {
		case tenantValue <= 0:
			return platformValue
		case platformValue <= 0:
			return tenantValue
		case tenantValue > platformValue:
			return platformValue
		default:
			return tenantValue
		}
	}

	if tenantValue < 0 {
		return platformValue
	}
	if tenantValue > platformValue {
		return platformValue
	}
	return tenantValue
}

func splitNormalizedLines(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.ToLower(strings.TrimSpace(line))
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func cloneGroupRateLimits(src map[string][2]int) map[string][2]int {
	out := make(map[string][2]int, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func clampTenantGroupRateLimits(tenant map[string][2]int, platform map[string][2]int) map[string][2]int {
	out := make(map[string][2]int, len(tenant))
	for group, limits := range tenant {
		if platformLimits, ok := platform[group]; ok {
			out[group] = [2]int{
				clampTenantInt(limits[0], platformLimits[0], true),
				clampTenantInt(limits[1], platformLimits[1], true),
			}
			continue
		}
		out[group] = limits
	}
	return out
}

func intersectStatusCodeRanges(a []operation_setting.StatusCodeRange, b []operation_setting.StatusCodeRange) []operation_setting.StatusCodeRange {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}
	out := make([]operation_setting.StatusCodeRange, 0)
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		start := a[i].Start
		if b[j].Start > start {
			start = b[j].Start
		}
		end := a[i].End
		if b[j].End < end {
			end = b[j].End
		}
		if start <= end {
			out = append(out, operation_setting.StatusCodeRange{Start: start, End: end})
		}
		if a[i].End < b[j].End {
			i++
		} else {
			j++
		}
	}
	return out
}

func parseTenantStatusCodeRanges(tenantId int, key string, fallback []operation_setting.StatusCodeRange) []operation_setting.StatusCodeRange {
	value := strings.TrimSpace(GetConfig(tenantId, key, ""))
	if value == "" {
		return append([]operation_setting.StatusCodeRange(nil), fallback...)
	}
	ranges, err := operation_setting.ParseHTTPStatusCodeRanges(value)
	if err != nil {
		common.SysError("tenant status code range parse failed (" + key + "): " + err.Error())
		return append([]operation_setting.StatusCodeRange(nil), fallback...)
	}
	return ranges
}

func GetTenantRetryTimes(tenantId int) int {
	tenantValue := GetConfigInt(tenantId, "RetryTimes", common.RetryTimes)
	return clampTenantInt(tenantValue, common.RetryTimes, false)
}

func GetTenantChannelDisableThreshold(tenantId int) float64 {
	value := GetConfigFloat64(tenantId, "ChannelDisableThreshold", common.ChannelDisableThreshold)
	if value < 0 {
		return common.ChannelDisableThreshold
	}
	return value
}

func GetTenantAutomaticDisableChannelEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, "AutomaticDisableChannelEnabled", common.AutomaticDisableChannelEnabled)
}

func GetTenantAutomaticEnableChannelEnabled(tenantId int) bool {
	return GetConfigBool(tenantId, "AutomaticEnableChannelEnabled", common.AutomaticEnableChannelEnabled)
}

func GetTenantAutomaticDisableKeywords(tenantId int) []string {
	override := GetConfig(tenantId, "AutomaticDisableKeywords", operation_setting.AutomaticDisableKeywordsToString())
	if strings.TrimSpace(override) == "" {
		return append([]string(nil), operation_setting.AutomaticDisableKeywords...)
	}
	return splitNormalizedLines(override)
}

func GetTenantAutomaticDisableStatusCodeRanges(tenantId int) []operation_setting.StatusCodeRange {
	return parseTenantStatusCodeRanges(tenantId, "AutomaticDisableStatusCodes", operation_setting.AutomaticDisableStatusCodeRanges)
}

func GetTenantAutomaticRetryStatusCodeRanges(tenantId int) []operation_setting.StatusCodeRange {
	tenantRanges := parseTenantStatusCodeRanges(tenantId, "AutomaticRetryStatusCodes", operation_setting.AutomaticRetryStatusCodeRanges)
	return intersectStatusCodeRanges(tenantRanges, operation_setting.AutomaticRetryStatusCodeRanges)
}

func ShouldTenantDisableByStatusCode(tenantId int, code int) bool {
	ranges := GetTenantAutomaticDisableStatusCodeRanges(tenantId)
	if code < 100 || code > 599 {
		return false
	}
	for _, r := range ranges {
		if code < r.Start {
			return false
		}
		if code <= r.End {
			return true
		}
	}
	return false
}

func ShouldTenantRetryByStatusCode(tenantId int, code int) bool {
	if operation_setting.IsAlwaysSkipRetryStatusCode(code) {
		return false
	}
	ranges := GetTenantAutomaticRetryStatusCodeRanges(tenantId)
	if code < 100 || code > 599 {
		return false
	}
	for _, r := range ranges {
		if code < r.Start {
			return false
		}
		if code <= r.End {
			return true
		}
	}
	return false
}

func GetTenantModelRequestRateLimitConfig(tenantId int) TenantModelRequestRateLimitConfig {
	cfg := TenantModelRequestRateLimitConfig{
		Enabled:         GetConfigBool(tenantId, "ModelRequestRateLimitEnabled", setting.ModelRequestRateLimitEnabled),
		DurationMinutes: clampTenantInt(GetConfigInt(tenantId, "ModelRequestRateLimitDurationMinutes", setting.ModelRequestRateLimitDurationMinutes), setting.ModelRequestRateLimitDurationMinutes, true),
		TotalCount:      clampTenantInt(GetConfigInt(tenantId, "ModelRequestRateLimitCount", setting.ModelRequestRateLimitCount), setting.ModelRequestRateLimitCount, true),
		SuccessCount:    clampTenantInt(GetConfigInt(tenantId, "ModelRequestRateLimitSuccessCount", setting.ModelRequestRateLimitSuccessCount), setting.ModelRequestRateLimitSuccessCount, true),
		GroupLimits:     cloneGroupRateLimits(setting.ModelRequestRateLimitGroup),
	}

	rawGroup := strings.TrimSpace(GetConfig(tenantId, "ModelRequestRateLimitGroup", ""))
	if rawGroup != "" {
		tenantGroupLimits := make(map[string][2]int)
		if err := json.Unmarshal([]byte(rawGroup), &tenantGroupLimits); err != nil {
			common.SysError("tenant model request rate limit group parse failed: " + err.Error())
		} else {
			cfg.GroupLimits = clampTenantGroupRateLimits(tenantGroupLimits, setting.ModelRequestRateLimitGroup)
		}
	}
	if cfg.DurationMinutes <= 0 {
		cfg.DurationMinutes = setting.ModelRequestRateLimitDurationMinutes
	}
	return cfg
}
