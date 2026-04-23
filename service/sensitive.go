package service

import (
	"bufio"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting"
)

func normalizedSensitiveWordsFromText(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	seen := make(map[string]struct{})
	words := make([]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		word := strings.ToLower(strings.TrimSpace(scanner.Text()))
		if word == "" {
			continue
		}
		if _, ok := seen[word]; ok {
			continue
		}
		seen[word] = struct{}{}
		words = append(words, word)
	}
	return words
}

func GetTenantSensitiveWords(tenantId int) []string {
	seen := make(map[string]struct{})
	words := make([]string, 0, len(setting.SensitiveWords))
	for _, word := range setting.SensitiveWords {
		normalized := strings.ToLower(strings.TrimSpace(word))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		words = append(words, normalized)
	}
	for _, word := range normalizedSensitiveWordsFromText(GetConfig(tenantId, "SensitiveWords", "")) {
		if _, ok := seen[word]; ok {
			continue
		}
		seen[word] = struct{}{}
		words = append(words, word)
	}
	return words
}

func ShouldCheckPromptSensitiveForTenant(tenantId int) bool {
	return GetConfigBool(tenantId, "CheckSensitiveEnabled", setting.CheckSensitiveEnabled) &&
		GetConfigBool(tenantId, "CheckSensitiveOnPromptEnabled", setting.CheckSensitiveOnPromptEnabled)
}

func ShouldStopOnSensitiveForTenant(tenantId int) bool {
	return GetConfigBool(tenantId, "StopOnSensitiveEnabled", setting.StopOnSensitiveEnabled)
}

func CheckSensitiveMessagesForTenant(tenantId int, messages []dto.Message) ([]string, error) {
	if len(messages) == 0 {
		return nil, nil
	}

	for _, message := range messages {
		arrayContent := message.ParseContent()
		for _, m := range arrayContent {
			if m.Type == "image_url" {
				// TODO: check image url
				continue
			}
			// 检查 text 是否为空
			if m.Text == "" {
				continue
			}
			if ok, words := SensitiveWordContainsForTenant(tenantId, m.Text); ok {
				return words, errors.New("sensitive words detected")
			}
		}
	}
	return nil, nil
}

func CheckSensitiveMessages(messages []dto.Message) ([]string, error) {
	return CheckSensitiveMessagesForTenant(0, messages)
}

func CheckSensitiveText(text string) (bool, []string) {
	return CheckSensitiveTextForTenant(0, text)
}

func CheckSensitiveTextForTenant(tenantId int, text string) (bool, []string) {
	return SensitiveWordContainsForTenant(tenantId, text)
}

// SensitiveWordContains 是否包含敏感词，返回是否包含敏感词和敏感词列表
func SensitiveWordContains(text string) (bool, []string) {
	return SensitiveWordContainsForTenant(0, text)
}

func SensitiveWordContainsForTenant(tenantId int, text string) (bool, []string) {
	words := GetTenantSensitiveWords(tenantId)
	if len(words) == 0 {
		return false, nil
	}
	if len(text) == 0 {
		return false, nil
	}
	checkText := strings.ToLower(text)
	return AcSearch(checkText, words, true)
}

// SensitiveWordReplace 敏感词替换，返回是否包含敏感词和替换后的文本
func SensitiveWordReplace(text string, returnImmediately bool) (bool, []string, string) {
	return SensitiveWordReplaceForTenant(0, text, returnImmediately)
}

func SensitiveWordReplaceForTenant(tenantId int, text string, returnImmediately bool) (bool, []string, string) {
	words := GetTenantSensitiveWords(tenantId)
	if len(words) == 0 {
		return false, nil, text
	}
	checkText := strings.ToLower(text)
	m := getOrBuildAC(words)
	hits := m.MultiPatternSearch([]rune(checkText), returnImmediately)
	if len(hits) > 0 {
		words := make([]string, 0, len(hits))
		var builder strings.Builder
		builder.Grow(len(text))
		lastPos := 0

		for _, hit := range hits {
			pos := hit.Pos
			word := string(hit.Word)
			builder.WriteString(text[lastPos:pos])
			builder.WriteString("**###**")
			lastPos = pos + len(word)
			words = append(words, word)
		}
		builder.WriteString(text[lastPos:])
		return true, words, builder.String()
	}
	return false, nil, text
}
