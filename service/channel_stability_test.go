package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/channel_stability"
	"github.com/QuantumNous/new-api/types"
)

func withOptionMapForChannelStabilityTest(t *testing.T, values map[string]string) {
	t.Helper()

	prevOptionMap := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = values
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prevOptionMap
		common.OptionMapRWMutex.Unlock()
	})
}

func TestChannelStabilityFlagsUseGlobalOptionMap(t *testing.T) {
	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityStreamBoundaryEnabledKey: "true",
	})

	if !IsChannelStabilityStreamBoundaryEnabled(0) {
		t.Fatalf("expected stream boundary flag to use global OptionMap value")
	}
}

func TestChannelStabilityFlagsDefaultFalseWhenMissing(t *testing.T) {
	withOptionMapForChannelStabilityTest(t, map[string]string{})

	if IsChannelStabilityHealthScoreEnabled(0) {
		t.Fatalf("expected missing health score flag to resolve false")
	}
}

func TestChannelStabilityFlagsReturnFalseForInvalidValue(t *testing.T) {
	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityCooldownEnabledKey: "not-a-bool",
	})

	if IsChannelStabilityCooldownEnabled(0) {
		t.Fatalf("expected invalid cooldown flag value to resolve false")
	}
}

func TestChannelStabilityFlagsPreferTenantOverride(t *testing.T) {
	restoreDB := setupTenantMonitorTestDB(t)
	defer restoreDB()

	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityErrorClassificationEnabledKey: "false",
		ChannelStabilityAffinityGovernanceEnabledKey:  "true",
	})

	if err := model.SetTenantOption(7, ChannelStabilityErrorClassificationEnabledKey, "true"); err != nil {
		t.Fatalf("set tenant true override: %v", err)
	}
	if err := model.SetTenantOption(8, ChannelStabilityAffinityGovernanceEnabledKey, "false"); err != nil {
		t.Fatalf("set tenant false override: %v", err)
	}
	InvalidateTenantOptionCache(7)
	InvalidateTenantOptionCache(8)

	if !IsChannelStabilityErrorClassificationEnabled(7) {
		t.Fatalf("expected tenant true override to win over false global option")
	}
	if IsChannelStabilityAffinityGovernanceEnabled(8) {
		t.Fatalf("expected tenant false override to win over true global option")
	}
}

func TestShouldCooldownChannelRequiresClassificationFlag(t *testing.T) {
	err := types.WithOpenAIError(types.OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests)
	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityErrorClassificationEnabledKey: "false",
	})

	if ShouldCooldownChannel(0, constant.ChannelTypeOpenAI, err) {
		t.Fatalf("expected cooldown precheck to stay off when classification flag is disabled")
	}

	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityErrorClassificationEnabledKey: "true",
	})
	if !ShouldCooldownChannel(0, constant.ChannelTypeOpenAI, err) {
		t.Fatalf("expected transient error to be eligible for cooldown when classification flag is enabled")
	}
}

func TestShouldDisableChannelFallsBackToLegacyWhenClassificationFlagDisabled(t *testing.T) {
	err := types.NewErrorWithStatusCode(errors.New("response time exceeded"), types.ErrorCodeChannelResponseTimeExceeded, http.StatusGatewayTimeout)
	withOptionMapForChannelStabilityTest(t, map[string]string{
		"AutomaticDisableChannelEnabled":              "true",
		ChannelStabilityErrorClassificationEnabledKey: "false",
	})

	if !ShouldDisableChannel(0, constant.ChannelTypeOpenAI, err) {
		t.Fatalf("expected legacy channel error handling to auto-disable when classification flag is off")
	}
}

func TestShouldDisableChannelUsesPermanentClassWhenClassificationFlagEnabled(t *testing.T) {
	withOptionMapForChannelStabilityTest(t, map[string]string{
		"AutomaticDisableChannelEnabled":              "true",
		ChannelStabilityErrorClassificationEnabledKey: "true",
	})

	transientErr := types.NewErrorWithStatusCode(errors.New("response time exceeded"), types.ErrorCodeChannelResponseTimeExceeded, http.StatusGatewayTimeout)
	if ShouldDisableChannel(0, constant.ChannelTypeOpenAI, transientErr) {
		t.Fatalf("expected transient channel error not to auto-disable when classification flag is on")
	}

	permanentErr := types.WithOpenAIError(types.OpenAIError{Message: "bad key", Code: "invalid_api_key"}, http.StatusUnauthorized)
	if !ShouldDisableChannel(0, constant.ChannelTypeOpenAI, permanentErr) {
		t.Fatalf("expected permanent error to auto-disable when classification flag is on")
	}
}

func TestShouldDisableChannelNeverDisablesFirstTokenTimeout(t *testing.T) {
	err := types.NewErrorWithStatusCode(errors.New("first token timeout"), types.ErrorCodeUpstreamFirstTokenTimeout, http.StatusBadGateway)
	withOptionMapForChannelStabilityTest(t, map[string]string{
		"AutomaticDisableChannelEnabled":              "true",
		"AutomaticDisableStatusCodes":                 "500-599",
		ChannelStabilityErrorClassificationEnabledKey: "false",
	})

	if ShouldDisableChannel(0, constant.ChannelTypeOpenAI, err) {
		t.Fatalf("expected first token timeout not to auto-disable with legacy disable rules")
	}

	withOptionMapForChannelStabilityTest(t, map[string]string{
		"AutomaticDisableChannelEnabled":              "true",
		"AutomaticDisableStatusCodes":                 "500-599",
		ChannelStabilityErrorClassificationEnabledKey: "true",
	})
	if ShouldDisableChannel(0, constant.ChannelTypeOpenAI, err) {
		t.Fatalf("expected first token timeout not to auto-disable with classifier rules")
	}
}

func TestHandleChannelAnomalySetsCooldownForTransient(t *testing.T) {
	restoreDB := setupTenantMonitorTestDB(t)
	defer restoreDB()
	if err := model.DB.AutoMigrate(&model.Channel{}); err != nil {
		t.Fatalf("migrate channel: %v", err)
	}

	prevRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = prevRedisEnabled })

	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityErrorClassificationEnabledKey: "true",
		ChannelStabilityCooldownEnabledKey:            "true",
	})

	channel := &model.Channel{
		Type:        constant.ChannelTypeOpenAI,
		Key:         "cooldown-service-key",
		Status:      common.ChannelStatusEnabled,
		Name:        "cooldown-service",
		Scope:       model.ChannelScopeTenant,
		TenantId:    77,
		CreatedTime: 1,
	}
	if err := model.WithTenantBypass(model.DB).Create(channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	err := types.WithOpenAIError(types.OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests)
	HandleChannelAnomaly(0, *types.NewChannelError(channel.Id, channel.Type, channel.Name, false, channel.Key, true), err)

	cooldown, ok := model.GetChannelCooldown(channel.Id)
	if !ok {
		t.Fatalf("expected transient error to set cooldown")
	}
	if cooldown.Count != 1 {
		t.Fatalf("cooldown count = %d, want 1", cooldown.Count)
	}
	if cooldown.Reason != "status=429" {
		t.Fatalf("cooldown reason = %q, want status=429", cooldown.Reason)
	}
}

func TestHandleChannelAnomalyUsesScheduledRetryAfter(t *testing.T) {
	restoreDB := setupTenantMonitorTestDB(t)
	defer restoreDB()
	if err := model.DB.AutoMigrate(&model.Channel{}); err != nil {
		t.Fatalf("migrate channel: %v", err)
	}

	prevRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = prevRedisEnabled })

	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityErrorClassificationEnabledKey: "true",
		ChannelStabilityCooldownEnabledKey:            "true",
	})

	channel := &model.Channel{
		Type:        constant.ChannelTypeOpenAI,
		Key:         "scheduled-cooldown-key",
		Status:      common.ChannelStatusEnabled,
		Name:        "scheduled-cooldown",
		Scope:       model.ChannelScopeTenant,
		TenantId:    77,
		CreatedTime: 1,
	}
	if err := model.WithTenantBypass(model.DB).Create(channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	resetAt := time.Now().Add(90 * time.Second)
	err := types.WithOpenAIError(
		types.OpenAIError{Message: "rate limit"},
		http.StatusTooManyRequests,
		types.ErrOptionWithChannelErrorHints(types.ChannelErrorHints{RetryAfter: &resetAt}),
	)
	HandleChannelAnomaly(0, *types.NewChannelError(channel.Id, channel.Type, channel.Name, false, channel.Key, true), err)

	cooldown, ok := model.GetChannelCooldown(channel.Id)
	if !ok {
		t.Fatalf("expected scheduled cooldown to be set")
	}
	if cooldown.Until < resetAt.Add(-2*time.Second).UnixMilli() || cooldown.Until > resetAt.Add(2*time.Second).UnixMilli() {
		t.Fatalf("cooldown until = %d, want around %d", cooldown.Until, resetAt.UnixMilli())
	}
	if !strings.Contains(cooldown.Reason, "retry_after=") {
		t.Fatalf("cooldown reason = %q, want retry_after", cooldown.Reason)
	}
}

func TestGetFirstTokenTimeoutUsesExactModelBeforeFamilyAndDefault(t *testing.T) {
	cfg := channel_stability.Get()
	original := channel_stability.Default()
	*cfg = original
	t.Cleanup(func() {
		*cfg = original
	})

	cfg.StreamBoundary.DefaultFirstTokenTimeoutMs = 11000
	cfg.StreamBoundary.ModelTimeoutOverrides = map[string]int{
		"gpt-5-thinking-special": 45000,
	}
	cfg.StreamBoundary.ModelFamilyOverrides = map[string]int{
		"gpt-5-thinking": 30000,
		"gpt-5":          20000,
	}

	if got := GetFirstTokenTimeout("gpt-5-thinking-special"); got != 45*time.Second {
		t.Fatalf("exact timeout = %v, want 45s", got)
	}
	if got := GetFirstTokenTimeout("gpt-5-thinking-preview"); got != 30*time.Second {
		t.Fatalf("family timeout = %v, want 30s", got)
	}
	if got := GetFirstTokenTimeout("gpt-4o"); got != 11*time.Second {
		t.Fatalf("default timeout = %v, want 11s", got)
	}
}

func TestNextChannelCooldownDurationBackoffAndCap(t *testing.T) {
	cfg := channel_stability.Get()
	original := channel_stability.Default()
	*cfg = original
	t.Cleanup(func() {
		*cfg = original
	})

	cfg.Cooldown.BaseDurationMs = 30_000
	cfg.Cooldown.MaxDurationMs = 300_000

	cases := []struct {
		count int
		want  time.Duration
	}{
		{count: 0, want: 30 * time.Second},
		{count: 1, want: 60 * time.Second},
		{count: 4, want: 300 * time.Second},
		{count: 5, want: 300 * time.Second},
	}
	for _, tc := range cases {
		if got := NextChannelCooldownDuration(tc.count); got != tc.want {
			t.Fatalf("NextChannelCooldownDuration(%d) = %v, want %v", tc.count, got, tc.want)
		}
	}
}

func TestScheduledChannelCooldownDurationClampsAndRespectsBackoff(t *testing.T) {
	now := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)

	duration, clamped := ScheduledChannelCooldownDuration(now, now.Add(2*time.Second), 30*time.Second)
	if !clamped {
		t.Fatalf("expected short retry-after to be clamped")
	}
	if duration != 30*time.Second {
		t.Fatalf("duration = %v, want fallback backoff 30s", duration)
	}

	duration, clamped = ScheduledChannelCooldownDuration(now, now.Add(8*time.Hour), 30*time.Second)
	if !clamped {
		t.Fatalf("expected long retry-after to be clamped")
	}
	if duration != 6*time.Hour {
		t.Fatalf("duration = %v, want 6h", duration)
	}
}
