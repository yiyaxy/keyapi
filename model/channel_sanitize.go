package model

import "encoding/json"

// SanitizeForTenantView mutates the channel in-place to remove sensitive or
// operational fields before returning to a tenant admin. Always strips Key.
// For platform-scoped channels, also strips HeaderOverride, ParamOverride,
// OtherSettings, Other, BaseURL, StatusCodeMapping, AutoBan, Balance,
// UsedQuota, and multi-key operational state. The Setting JSON is reduced
// to ONLY the fields a tenant legitimately needs to understand its own
// bill — currently just `channel_ratio` — because that value is already
// observable in each request's quota and hiding it in the UI makes the
// pricing formula look dishonest (see 2026-04-24-dual-ledger-admin-ui §8.4
// and the "Tenant markup dialog"/"FormulaPills" contract).
//
// Sensitive fields intentionally kept hidden: proxy, system_prompt,
// model_ratio_override, ChannelRatioOverride, and any future admin-only
// channel tuning keys.
// See spec §7.4.
func SanitizeForTenantView(c *Channel) {
	if c == nil {
		return
	}
	c.Key = ""
	c.Keys = nil

	if c.Scope != ChannelScopePlatform {
		return
	}

	// Platform rows: strip everything operational except the
	// tenant-observable pricing fields in Setting.
	c.Setting = redactPlatformSettingForTenantView(c.Setting)
	empty := ""
	c.HeaderOverride = &empty
	c.ParamOverride = &empty
	c.OtherSettings = ""
	c.Other = ""
	c.BaseURL = &empty // BaseURL is *string in this codebase
	c.StatusCodeMapping = &empty
	zero := 0
	c.AutoBan = &zero
	c.Balance = 0
	c.BalanceUpdatedTime = 0
	c.UsedQuota = 0
	c.TestTime = 0
	c.ResponseTime = 0

	c.ChannelInfo.MultiKeyStatusList = nil
	c.ChannelInfo.MultiKeyDisabledReason = nil
	c.ChannelInfo.MultiKeyDisabledTime = nil
}

// redactPlatformSettingForTenantView keeps the value of `channel_ratio` (if
// any) and drops everything else. Returns a non-nil *string pointing to the
// minimized JSON, or to an empty string when no preserved field is present.
//
// Whitelist approach (keep only enumerated keys) is safer than blacklist:
// any future key added by platform admins defaults to hidden unless
// explicitly opted in here.
func redactPlatformSettingForTenantView(raw *string) *string {
	empty := ""
	if raw == nil || *raw == "" {
		return &empty
	}
	var src map[string]json.RawMessage
	if err := json.Unmarshal([]byte(*raw), &src); err != nil {
		return &empty
	}
	preserved := make(map[string]json.RawMessage, 1)
	if v, ok := src["channel_ratio"]; ok {
		preserved["channel_ratio"] = v
	}
	if len(preserved) == 0 {
		return &empty
	}
	out, err := json.Marshal(preserved)
	if err != nil {
		return &empty
	}
	s := string(out)
	return &s
}

// SanitizeListForTenantView applies SanitizeForTenantView to each element.
func SanitizeListForTenantView(list []*Channel) {
	for _, c := range list {
		SanitizeForTenantView(c)
	}
}

// SanitizeForCopy returns a new Channel value suitable for insert: only
// whitelisted metadata fields are carried from src. Key, HeaderOverride,
// ParamOverride, OtherSettings, Other, Balance, UsedQuota, TestTime,
// ResponseTime, and multi-key state are NEVER copied. The caller must
// supply the target tenantId; scope is forced to tenant.
// See spec §9.2.
func SanitizeForCopy(src *Channel, targetTenantId int) *Channel {
	if src == nil {
		return nil
	}
	dst := Channel{
		// whitelist
		Type:         src.Type,
		Name:         src.Name,
		Models:       src.Models,
		Group:        src.Group,
		ModelMapping: src.ModelMapping,
		Priority:     src.Priority,
		Weight:       src.Weight,
		Tag:          src.Tag,

		// forced fields
		Id:       0,
		Scope:    ChannelScopeTenant,
		TenantId: targetTenantId,
		Status:   src.Status,

		// Setting copied only after whitelist-filter via code below; initially empty.
		// For v1 simplicity we do not copy Setting at all — user reconfigures in UI.
		// This is a conservative choice; can be relaxed later.
	}
	return &dst
}
