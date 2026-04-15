package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

// ApplyPromptRules applies prompt replacement rules to the request messages.
func ApplyPromptRules(request *dto.GeneralOpenAIRequest, channelId int) {
	if request == nil || len(request.Messages) == 0 {
		return
	}

	rules := model.GetPromptRulesForChannel(channelId)
	if len(rules) == 0 {
		return
	}

	for _, rule := range rules {
		keywords := strings.Split(rule.Keyword, "\n")
		switch rule.Type {
		case model.PromptRuleTypeReplace:
			applyReplaceRule(request, keywords, rule.Replacement)
		case model.PromptRuleTypeKeyword:
			applyKeywordRule(request, keywords, rule.Replacement)
		}
	}
}

// ApplyResponseContentRules applies type=3 response replacement rules to LLM response content.
func ApplyResponseContentRules(content string, channelId int) string {
	if content == "" {
		return content
	}
	rules := model.GetPromptRulesForChannel(channelId)
	for _, rule := range rules {
		if rule.Type != model.PromptRuleTypeResponse {
			continue
		}
		for _, kw := range strings.Split(rule.Keyword, "\n") {
			kw = strings.TrimSpace(kw)
			if kw != "" {
				content = strings.ReplaceAll(content, kw, rule.Replacement)
			}
		}
	}
	return content
}

// HasResponseRules checks if there are any response replacement rules for a channel.
func HasResponseRules(channelId int) bool {
	return model.HasResponseRulesForChannel(channelId)
}

// applyReplaceRule checks the last user message for trigger words and replaces the entire message.
func applyReplaceRule(request *dto.GeneralOpenAIRequest, keywords []string, replacement string) {
	for i := len(request.Messages) - 1; i >= 0; i-- {
		if request.Messages[i].Role != "user" {
			continue
		}
		content := request.Messages[i].StringContent()
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw != "" && strings.Contains(content, kw) {
				request.Messages[i].SetStringContent(replacement)
				return
			}
		}
		return // only check the last user message
	}
}

// applyKeywordRule does string replacement in all user messages.
func applyKeywordRule(request *dto.GeneralOpenAIRequest, keywords []string, replacement string) {
	for i := range request.Messages {
		if request.Messages[i].Role != "user" {
			continue
		}
		content := request.Messages[i].StringContent()
		changed := false
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw != "" && strings.Contains(content, kw) {
				content = strings.ReplaceAll(content, kw, replacement)
				changed = true
			}
		}
		if changed {
			request.Messages[i].SetStringContent(content)
		}
	}
}

// HasRewriteRules checks if there are any AI rewrite rules for a channel.
func HasRewriteRules(channelId int) bool {
	return model.HasRewriteRulesForChannel(channelId)
}

// ApplyResponseRewriteRules checks response content for type=4 keywords.
// If found, calls LLM to rewrite. Returns new content and whether rewrite happened.
func ApplyResponseRewriteRules(content string, channelId int, modelName string) (string, bool) {
	if content == "" {
		return content, false
	}
	rules := model.GetPromptRulesForChannel(channelId)
	for _, rule := range rules {
		if rule.Type != model.PromptRuleTypeRewrite {
			continue
		}
		for _, kw := range strings.Split(rule.Keyword, "\n") {
			kw = strings.TrimSpace(kw)
			if kw != "" && strings.Contains(content, kw) {
				prompt := rule.Replacement
				prompt = strings.ReplaceAll(prompt, "{{content}}", content)
				prompt = strings.ReplaceAll(prompt, "{{model}}", modelName)
				rewritten, err := callRewriteLLM(prompt, rule.RewriteChannelId, rule.RewriteModel)
				if err != nil {
					common.SysError("rewrite LLM call failed: " + err.Error())
					return content, false
				}
				return rewritten, true
			}
		}
	}
	return content, false
}

func callRewriteLLM(prompt string, ruleChannelId int, ruleModel string) (string, error) {
	chId := ruleChannelId
	if chId == 0 {
		chId = common.TranslationChannelId
	}
	if chId == 0 {
		return "", fmt.Errorf("no channel configured for rewrite")
	}
	channel, err := model.GetChannelById(chId, true)
	if err != nil {
		return "", fmt.Errorf("get channel failed: %v", err)
	}
	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		return "", fmt.Errorf("channel has no base URL")
	}

	type llmMsg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type llmReq struct {
		Model    string   `json:"model"`
		Messages []llmMsg `json:"messages"`
	}
	type llmResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	mdl := ruleModel
	if mdl == "" {
		mdl = common.TranslationModel
	}
	reqBody := llmReq{
		Model:    mdl,
		Messages: []llmMsg{{Role: "user", Content: prompt}},
	}
	jsonBody, _ := json.Marshal(reqBody)

	url := strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var aiResp llmResp
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return "", err
	}
	if len(aiResp.Choices) == 0 {
		return "", fmt.Errorf("empty choices from rewrite LLM")
	}
	return strings.TrimSpace(aiResp.Choices[0].Message.Content), nil
}
