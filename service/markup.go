package service

import "github.com/QuantumNous/new-api/model"

// EffectiveMarkup resolves the markup ratio applied to a request using the
// given channel (may be nil) and tenant plan (may be nil).
// Returns (ratio, source) where source is one of:
//   - "channel": channel.MarkupRatio is set
//   - "plan":    fell back to plan.PlatformMarkup
//   - "none":    no markup applies (returns 1.0)
//
// See spec §5.1.
func EffectiveMarkup(ch *model.Channel, plan *model.TenantPlan) (float64, string) {
	if ch == nil || ch.Scope != model.ChannelScopePlatform {
		return 1.0, "none"
	}
	if ch.MarkupRatio != nil {
		return *ch.MarkupRatio, "channel"
	}
	if plan != nil && plan.PlatformMarkup > 0 {
		return plan.PlatformMarkup, "plan"
	}
	return 1.0, "none"
}
