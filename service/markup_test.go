package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestEffectiveMarkup(t *testing.T) {
	f := func(v float64) *float64 { return &v }

	cases := []struct {
		name   string
		ch     *model.Channel
		plan   *model.TenantPlan
		want   float64
		source string
	}{
		{"tenant_scope_returns_1.0", &model.Channel{Scope: model.ChannelScopeTenant}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.0, "none"},
		{"platform_channel_override", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: f(1.3)}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.3, "channel"},
		{"platform_falls_back_to_plan", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.5, "plan"},
		{"platform_no_plan_uses_1.0", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, nil, 1.0, "none"},
		{"zero_plan_treated_as_unset", &model.Channel{Scope: model.ChannelScopePlatform, MarkupRatio: nil}, &model.TenantPlan{PlatformMarkup: 0}, 1.0, "none"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, src := EffectiveMarkup(c.ch, c.plan)
			if got != c.want || src != c.source {
				t.Errorf("got (%v, %q), want (%v, %q)", got, src, c.want, c.source)
			}
		})
	}
}
