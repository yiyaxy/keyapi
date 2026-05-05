package imagegen

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	OptionEnabled                  = "image_gen.enabled"
	OptionDefaultModel             = "image_gen.default_model"
	OptionAllowedModels            = "image_gen.allowed_models"
	OptionSubmittedMessageTemplate = "image_gen.submitted_message_template"

	DefaultModel = "gpt-image-2"

	// DefaultSubmittedMessageTemplate is used when the operator has not configured
	// a custom template. {task_id} is always substituted; {task_url} is dropped
	// (along with surrounding whitespace on the same fragment) when no public URL
	// is available for the task.
	DefaultSubmittedMessageTemplate = "你的图片生成任务已提交，任务 ID：{task_id}。可以前往 {task_url} 查看进度。生成完成后我会继续把图片发在这里。\n\n"
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

// SubmittedMessageTemplate returns the configured template, or the default
// when unset. An explicitly-configured empty string is honored and means
// "send no submitted message at all".
func SubmittedMessageTemplate() string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if common.OptionMap == nil {
		return DefaultSubmittedMessageTemplate
	}
	value, ok := common.OptionMap[OptionSubmittedMessageTemplate]
	if !ok {
		return DefaultSubmittedMessageTemplate
	}
	return value
}

// RenderSubmittedMessage applies the configured template. Returns "" when the
// template is empty (operator opted out) or when the template lacks a task_id
// placeholder while taskID is non-empty (misconfiguration — caller should skip
// rather than send a meaningless message).
//
// When taskURL is empty, the {task_url} placeholder and any leading/trailing
// whitespace bonded to it on the same fragment are dropped, so operators can
// write a single template that degrades gracefully.
func RenderSubmittedMessage(taskID, taskURL string) string {
	tmpl := SubmittedMessageTemplate()
	if tmpl == "" {
		return ""
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return ""
	}
	out := tmpl
	if strings.TrimSpace(taskURL) == "" {
		out = stripTaskURLFragment(out)
	} else {
		out = strings.ReplaceAll(out, "{task_url}", taskURL)
	}
	out = strings.ReplaceAll(out, "{task_id}", taskID)
	return out
}

// stripTaskURLFragment removes "{task_url}" and any non-newline whitespace
// directly surrounding it, so a missing URL doesn't leave double spaces or a
// dangling preposition like "前往  查看".
func stripTaskURLFragment(s string) string {
	for {
		idx := strings.Index(s, "{task_url}")
		if idx < 0 {
			return s
		}
		start := idx
		for start > 0 {
			r := s[start-1]
			if r == ' ' || r == '\t' {
				start--
				continue
			}
			break
		}
		end := idx + len("{task_url}")
		for end < len(s) {
			r := s[end]
			if r == ' ' || r == '\t' {
				end++
				continue
			}
			break
		}
		s = s[:start] + s[end:]
	}
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
