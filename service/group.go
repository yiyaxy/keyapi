package service

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func cloneMapStringString(src map[string]string) map[string]string {
	out := make(map[string]string, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func cloneMapStringFloat64(src map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func cloneNestedMapStringFloat64(src map[string]map[string]float64) map[string]map[string]float64 {
	out := make(map[string]map[string]float64, len(src))
	for k, inner := range src {
		copiedInner := make(map[string]float64, len(inner))
		for innerKey, innerValue := range inner {
			copiedInner[innerKey] = innerValue
		}
		out[k] = copiedInner
	}
	return out
}

func tenantStringMapConfig(tenantId int, key string, fallback map[string]string) map[string]string {
	value := strings.TrimSpace(GetConfig(tenantId, key, ""))
	if value == "" {
		return cloneMapStringString(fallback)
	}
	result := make(map[string]string)
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		common.SysError("tenant string map config parse failed (" + key + "): " + err.Error())
		return cloneMapStringString(fallback)
	}
	return result
}

func tenantFloatMapConfig(tenantId int, key string, fallback map[string]float64) map[string]float64 {
	value := strings.TrimSpace(GetConfig(tenantId, key, ""))
	if value == "" {
		return cloneMapStringFloat64(fallback)
	}
	result := make(map[string]float64)
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		common.SysError("tenant float map config parse failed (" + key + "): " + err.Error())
		return cloneMapStringFloat64(fallback)
	}
	return result
}

func tenantNestedFloatMapConfig(tenantId int, key string, fallback map[string]map[string]float64) map[string]map[string]float64 {
	value := strings.TrimSpace(GetConfig(tenantId, key, ""))
	if value == "" {
		return cloneNestedMapStringFloat64(fallback)
	}
	result := make(map[string]map[string]float64)
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		common.SysError("tenant nested float map config parse failed (" + key + "): " + err.Error())
		return cloneNestedMapStringFloat64(fallback)
	}
	return result
}

func tenantStringListConfig(tenantId int, key string, fallback []string) []string {
	value := strings.TrimSpace(GetConfig(tenantId, key, ""))
	if value == "" {
		return append([]string(nil), fallback...)
	}
	result := make([]string, 0)
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		common.SysError("tenant string list config parse failed (" + key + "): " + err.Error())
		return append([]string(nil), fallback...)
	}
	return result
}

func defaultTenantGroupGroupRatioMap() map[string]map[string]float64 {
	return cloneNestedMapStringFloat64(ratio_setting.GetGroupRatioSetting().GroupGroupRatio.ReadAll())
}

func GetTenantUserUsableGroups(tenantId int, userGroup string) map[string]string {
	groupsCopy := tenantStringMapConfig(tenantId, "UserUsableGroups", setting.GetUserUsableGroupsCopy())
	if userGroup != "" {
		if specialSettings, ok := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup); ok {
			for specialGroup, desc := range specialSettings {
				switch {
				case strings.HasPrefix(specialGroup, "-:"):
					delete(groupsCopy, strings.TrimPrefix(specialGroup, "-:"))
				case strings.HasPrefix(specialGroup, "+:"):
					groupsCopy[strings.TrimPrefix(specialGroup, "+:")] = desc
				default:
					groupsCopy[specialGroup] = desc
				}
			}
		}
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "用户分组"
		}
	}
	return groupsCopy
}

func GetUserUsableGroups(userGroup string) map[string]string {
	return GetTenantUserUsableGroups(0, userGroup)
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func GroupInTenantUserUsableGroups(tenantId int, userGroup, groupName string) bool {
	_, ok := GetTenantUserUsableGroups(tenantId, userGroup)[groupName]
	return ok
}

func GetTenantGroupRatioMap(tenantId int) map[string]float64 {
	return tenantFloatMapConfig(tenantId, "GroupRatio", ratio_setting.GetGroupRatioCopy())
}

func GetTenantGroupGroupRatioMap(tenantId int) map[string]map[string]float64 {
	return tenantNestedFloatMapConfig(tenantId, "GroupGroupRatio", defaultTenantGroupGroupRatioMap())
}

func GetTenantTopupGroupRatioMap(tenantId int) map[string]float64 {
	return tenantFloatMapConfig(tenantId, "TopupGroupRatio", common.GetTopupGroupRatioCopy())
}

func GetTenantGroupNames(tenantId int) []string {
	groupRatioMap := GetTenantGroupRatioMap(tenantId)
	names := make([]string, 0, len(groupRatioMap))
	for name := range groupRatioMap {
		names = append(names, name)
	}
	return names
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	return GetTenantUserAutoGroup(0, userGroup)
}

func GetTenantUserAutoGroup(tenantId int, userGroup string) []string {
	groups := GetTenantUserUsableGroups(tenantId, userGroup)
	autoGroups := make([]string, 0)
	for _, group := range tenantStringListConfig(tenantId, "AutoGroups", setting.GetAutoGroups()) {
		if _, ok := groups[group]; ok {
			autoGroups = append(autoGroups, group)
		}
	}
	return autoGroups
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
func GetUserGroupRatio(userGroup, group string) float64 {
	return GetTenantUserGroupRatio(0, userGroup, group)
}

func GetTenantUserGroupRatioFromMaps(groupRatioMap map[string]float64, groupGroupRatioMap map[string]map[string]float64, userGroup, group string) (float64, bool) {
	if specialMap, ok := groupGroupRatioMap[userGroup]; ok {
		if ratio, ok := specialMap[group]; ok {
			return ratio, true
		}
	}
	if ratio, ok := groupRatioMap[group]; ok {
		return ratio, false
	}
	common.SysLog("tenant group ratio not found: " + group)
	return 1, false
}

func GetTenantUserGroupRatio(tenantId int, userGroup, group string) float64 {
	groupGroupRatioMap := GetTenantGroupGroupRatioMap(tenantId)
	groupRatioMap := GetTenantGroupRatioMap(tenantId)
	ratio, _ := GetTenantUserGroupRatioFromMaps(groupRatioMap, groupGroupRatioMap, userGroup, group)
	return ratio
}

func GetTenantDefaultUseAutoGroup(tenantId int) bool {
	return GetConfigBool(tenantId, "DefaultUseAutoGroup", setting.DefaultUseAutoGroup)
}

func GetTenantTopupGroupRatio(tenantId int, group string) float64 {
	groupRatioMap := GetTenantTopupGroupRatioMap(tenantId)
	if ratio, ok := groupRatioMap[group]; ok {
		return ratio
	}
	common.SysLog("tenant topup group ratio not found: " + group)
	return 1
}
