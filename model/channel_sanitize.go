package model

// SanitizeForTenantView mutates the channel in-place to remove sensitive or
// operational fields before returning to a tenant admin. Always strips Key.
// For platform-scoped channels, also strips Setting, HeaderOverride,
// ParamOverride, OtherSettings, Other, BaseURL, StatusCodeMapping, AutoBan,
// Balance, UsedQuota, and multi-key operational state.
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

	// Platform rows: strip everything operational.
	empty := ""
	c.Setting = &empty
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
