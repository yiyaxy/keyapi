package model

// FilterByTenantMode implements the 4 routing modes.
// Inputs:
//
//	tenantCandidates   — abilities owned by the tenant (scope='tenant', tenant_id=current)
//	platformCandidates — abilities with scope='platform' (tenant_id=0)
//	mode               — one of PlatformChannelMode*; empty/invalid treated as private_priority
//	disabled           — set of channel_ids the tenant has disabled (from tenant_channel_overrides)
//
// Returns the resulting candidate slice; "disabled" platforms are always removed
// regardless of mode. The four mode semantics match spec §4.2.
func FilterByTenantMode(
	tenantCandidates []Ability,
	platformCandidates []Ability,
	mode string,
	disabled map[int]struct{},
) []Ability {
	// Remove disabled platform channels (disable has no meaning for tenant-owned rows).
	var effectivePlatform []Ability
	if len(disabled) > 0 {
		effectivePlatform = make([]Ability, 0, len(platformCandidates))
		for _, a := range platformCandidates {
			if _, off := disabled[a.ChannelId]; off {
				continue
			}
			effectivePlatform = append(effectivePlatform, a)
		}
	} else {
		effectivePlatform = platformCandidates
	}

	switch mode {
	case PlatformChannelModeOnlyPrivate:
		return tenantCandidates
	case PlatformChannelModeOnlyPlatform:
		return effectivePlatform
	case PlatformChannelModePlatformPriority:
		if len(effectivePlatform) > 0 {
			return effectivePlatform
		}
		return tenantCandidates
	case PlatformChannelModePrivatePriority, "":
		fallthrough
	default:
		if len(tenantCandidates) > 0 {
			return tenantCandidates
		}
		return effectivePlatform
	}
}
