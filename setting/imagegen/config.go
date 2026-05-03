package imagegen

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	OptionEnabled       = "image_gen.enabled"
	OptionDefaultModel  = "image_gen.default_model"
	OptionAllowedModels = "image_gen.allowed_models"

	DefaultModel = "gpt-image-2"
)

func getOption(key, fallback string) string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if common.OptionMap == nil {
		return fallback
	}
	value, ok := common.OptionMap[key]
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func Enabled() bool {
	value := strings.TrimSpace(getOption(OptionEnabled, "false"))
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return false
	}
	return enabled
}

func DefaultImageModel() string {
	return strings.TrimSpace(getOption(OptionDefaultModel, DefaultModel))
}

func AllowedModels() []string {
	raw := strings.TrimSpace(getOption(OptionAllowedModels, ""))
	if raw == "" {
		return nil
	}
	var models []string
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &models); err == nil {
			return compactModels(models)
		}
	}
	return compactModels(strings.Split(raw, ","))
}

func IsAllowedModel(model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	allowed := AllowedModels()
	if len(allowed) == 0 {
		return true
	}
	for _, item := range allowed {
		if item == model {
			return true
		}
	}
	return false
}

func compactModels(models []string) []string {
	result := make([]string, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		result = append(result, model)
	}
	return result
}
