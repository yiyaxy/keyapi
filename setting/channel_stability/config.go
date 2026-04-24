package channel_stability

import "github.com/QuantumNous/new-api/setting/config"

const DefaultFirstTokenTimeoutMs = 10000
const (
	DefaultCooldownBaseDurationMs  = 30000
	DefaultCooldownMaxDurationMs   = 300000
	DefaultCooldownCountWindowMs   = 24 * 60 * 60 * 1000
	DefaultWarmupStepMs            = 30000
	DefaultWarmupDurationMs        = 120000
	DefaultWarmupStartFactor       = 0.10
	DefaultCooldownEscalationLimit = 5
)

type StreamBoundaryConfig struct {
	DefaultFirstTokenTimeoutMs int            `json:"default_first_token_timeout_ms"`
	ModelTimeoutOverrides      map[string]int `json:"model_timeout_overrides"`
	ModelFamilyOverrides       map[string]int `json:"model_family_overrides"`
}

type CooldownConfig struct {
	BaseDurationMs    int     `json:"base_duration_ms"`
	MaxDurationMs     int     `json:"max_duration_ms"`
	CountWindowMs     int     `json:"count_window_ms"`
	WarmupStepMs      int     `json:"warmup_step_ms"`
	WarmupDurationMs  int     `json:"warmup_duration_ms"`
	WarmupStartFactor float64 `json:"warmup_start_factor"`
	EscalationLimit   int     `json:"escalation_limit"`
}

type Config struct {
	StreamBoundary StreamBoundaryConfig `json:"stream_boundary"`
	Cooldown       CooldownConfig       `json:"cooldown"`
}

var defaultConfig = Config{
	StreamBoundary: StreamBoundaryConfig{
		DefaultFirstTokenTimeoutMs: DefaultFirstTokenTimeoutMs,
		ModelTimeoutOverrides:      map[string]int{},
		ModelFamilyOverrides: map[string]int{
			"reasoning":      30000,
			"o1":             60000,
			"gpt-5-thinking": 30000,
			"deepseek-r1":    30000,
		},
	},
	Cooldown: CooldownConfig{
		BaseDurationMs:    DefaultCooldownBaseDurationMs,
		MaxDurationMs:     DefaultCooldownMaxDurationMs,
		CountWindowMs:     DefaultCooldownCountWindowMs,
		WarmupStepMs:      DefaultWarmupStepMs,
		WarmupDurationMs:  DefaultWarmupDurationMs,
		WarmupStartFactor: DefaultWarmupStartFactor,
		EscalationLimit:   DefaultCooldownEscalationLimit,
	},
}

var channelStabilityConfig = cloneConfig(defaultConfig)

func init() {
	config.GlobalConfig.Register("channel_stability", &channelStabilityConfig)
}

func Default() Config {
	return cloneConfig(defaultConfig)
}

func Get() *Config {
	return &channelStabilityConfig
}

func cloneConfig(cfg Config) Config {
	cloned := cfg
	cloned.StreamBoundary.ModelTimeoutOverrides = cloneIntMap(cfg.StreamBoundary.ModelTimeoutOverrides)
	cloned.StreamBoundary.ModelFamilyOverrides = cloneIntMap(cfg.StreamBoundary.ModelFamilyOverrides)
	return cloned
}

func cloneIntMap(src map[string]int) map[string]int {
	if src == nil {
		return nil
	}
	dst := make(map[string]int, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}
