package service

import (
	"fmt"
	"strconv"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// tenantOptionCache caches tenant-specific option values.
// Key format: "tenantId:optionKey", value is the cached string (or nil sentinel for miss).
var tenantOptionCache sync.Map

type cachedValue struct {
	value string
	found bool
}

func cacheKey(tenantId int, key string) string {
	return fmt.Sprintf("%d:%s", tenantId, key)
}

// GetConfig resolves a config value with three-layer priority:
//  1. Tenant-specific override (tenant_options table)
//  2. Platform default (global OptionMap)
//  3. Code default (fallback)
func GetConfig(tenantId int, key string, codeDefault string) string {
	// Layer 1: tenant override (with cache)
	// tenantId <= 0 means "no tenant context", so skip tenant_options entirely.
	if tenantId > 0 {
		ck := cacheKey(tenantId, key)
		if cached, ok := tenantOptionCache.Load(ck); ok {
			cv := cached.(*cachedValue)
			if cv.found {
				return cv.value
			}
			// cached miss — fall through to platform default
		} else {
			// Not in cache — query DB
			if val, found := model.GetTenantOption(tenantId, key); found {
				tenantOptionCache.Store(ck, &cachedValue{value: val, found: true})
				return val
			}
			// Cache the miss so we don't hit DB every time
			tenantOptionCache.Store(ck, &cachedValue{found: false})
		}
	}

	// Layer 2: platform default (global OptionMap)
	common.OptionMapRWMutex.RLock()
	if val, ok := common.OptionMap[key]; ok {
		common.OptionMapRWMutex.RUnlock()
		return val
	}
	common.OptionMapRWMutex.RUnlock()

	// Layer 3: code default
	return codeDefault
}

// GetConfigBool resolves a boolean config value with three-layer priority.
func GetConfigBool(tenantId int, key string, codeDefault bool) bool {
	val := GetConfig(tenantId, key, strconv.FormatBool(codeDefault))
	return val == "true"
}

// GetConfigInt resolves an integer config value with three-layer priority.
func GetConfigInt(tenantId int, key string, codeDefault int) int {
	val := GetConfig(tenantId, key, strconv.Itoa(codeDefault))
	result, err := strconv.Atoi(val)
	if err != nil {
		return codeDefault
	}
	return result
}

// GetConfigFloat64 resolves a float64 config value with three-layer priority.
func GetConfigFloat64(tenantId int, key string, codeDefault float64) float64 {
	val := GetConfig(tenantId, key, strconv.FormatFloat(codeDefault, 'f', -1, 64))
	result, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return codeDefault
	}
	return result
}

// InvalidateTenantOptionCache removes all cached entries for a given tenant.
func InvalidateTenantOptionCache(tenantId int) {
	prefix := fmt.Sprintf("%d:", tenantId)
	tenantOptionCache.Range(func(key, _ any) bool {
		if k, ok := key.(string); ok && len(k) > len(prefix) && k[:len(prefix)] == prefix {
			tenantOptionCache.Delete(key)
		}
		return true
	})
}

// InvalidateTenantOptionCacheKey removes a single cached entry for a tenant+key pair.
func InvalidateTenantOptionCacheKey(tenantId int, key string) {
	tenantOptionCache.Delete(cacheKey(tenantId, key))
}
