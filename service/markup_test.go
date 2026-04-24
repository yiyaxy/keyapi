package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestEffectiveMarkup(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	if model.DB != nil {
		if err := model.DB.Where("tenant_id = ? AND channel_id = ?", 1001, 2002).Delete(&model.TenantPlatformChannelMarkup{}).Error; err != nil {
			t.Fatalf("cleanup tenant channel markup: %v", err)
		}
		if err := model.DB.Create(&model.TenantPlatformChannelMarkup{
			TenantId:    1001,
			ChannelId:   2002,
			MarkupRatio: 1.8,
			Enabled:     true,
		}).Error; err != nil {
			t.Fatalf("seed tenant channel markup: %v", err)
		}
		t.Cleanup(func() {
			_ = model.DB.Where("tenant_id = ? AND channel_id = ?", 1001, 2002).Delete(&model.TenantPlatformChannelMarkup{}).Error
		})
	}

	cases := []struct {
		name   string
		ch     *model.Channel
		plan   *model.TenantPlan
		want   float64
		source string
	}{
		{"tenant_scope_returns_1.0", &model.Channel{Scope: model.ChannelScopeTenant}, &model.TenantPlan{PlatformMarkup: 1.5}, 1.0, "none"},
		{"tenant_channel_override_wins", &model.Channel{Id: 2002, Scope: model.ChannelScopePlatform, MarkupRatio: f(1.3)}, &model.TenantPlan{TenantId: 1001, PlatformMarkup: 1.5}, 1.8, "tenant_channel"},
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
