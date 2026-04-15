package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const translateMaxRetries = 3

type translateRequest struct {
	Model    string              `json:"model"`
	Messages []translateMessage  `json:"messages"`
}

type translateMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type translateResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type translatedContent struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

// callLLMTranslateOnce performs a single LLM translation attempt
func callLLMTranslateOnce(channel *model.Channel, fieldsJSON, targetLang string) (string, error) {
	baseURL := channel.GetBaseURL()
	systemPrompt := fmt.Sprintf(
		`Translate the following JSON values to %s. Return ONLY the translated JSON object with the same keys. Preserve markdown formatting. Do not add any explanation.`,
		targetLang,
	)
	reqBody := translateRequest{
		Model: common.TranslationModel,
		Messages: []translateMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: fieldsJSON},
		},
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

	var aiResp translateResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return "", err
	}
	if len(aiResp.Choices) == 0 {
		return "", fmt.Errorf("empty choices")
	}

	raw := strings.TrimSpace(aiResp.Choices[0].Message.Content)
	if strings.HasPrefix(raw, "```") {
		if idx := strings.Index(raw[3:], "\n"); idx >= 0 {
			raw = raw[3+idx+1:]
		}
		if strings.HasSuffix(raw, "```") {
			raw = raw[:len(raw)-3]
		}
		raw = strings.TrimSpace(raw)
	}
	return raw, nil
}

// callLLMTranslate sends fields JSON to LLM with retry mechanism
func callLLMTranslate(fieldsJSON, targetLang string) (string, error) {
	channel, err := model.GetChannelById(common.TranslationChannelId, true)
	if err != nil {
		return "", fmt.Errorf("get channel failed: %v", err)
	}
	if channel.GetBaseURL() == "" {
		return "", fmt.Errorf("channel has no base URL")
	}

	var lastErr error
	for attempt := 0; attempt < translateMaxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
		raw, err := callLLMTranslateOnce(channel, fieldsJSON, targetLang)
		if err == nil {
			return raw, nil
		}
		lastErr = err
		common.SysError(fmt.Sprintf("translate: attempt %d/%d failed: %v", attempt+1, translateMaxRetries, err))
	}
	return "", fmt.Errorf("all %d attempts failed: %v", translateMaxRetries, lastErr)
}

func TranslateMessage(messageId int, title, content, targetLang string) (*model.MessageTranslation, error) {
	if common.TranslationChannelId == 0 || common.TranslationModel == "" {
		return nil, nil
	}

	cached, err := model.GetTranslation(messageId, targetLang)
	if err == nil && cached != nil {
		return cached, nil
	}

	fieldsJSON, _ := json.Marshal(map[string]string{"title": title, "content": content})
	raw, err := callLLMTranslate(string(fieldsJSON), targetLang)
	if err != nil {
		common.SysError("translate: " + err.Error())
		return nil, nil
	}

	var translated translatedContent
	if err := json.Unmarshal([]byte(raw), &translated); err != nil {
		common.SysError("translate: parse translated JSON failed: " + err.Error())
		return nil, nil
	}

	t := &model.MessageTranslation{
		MessageId: messageId,
		Language:  targetLang,
		Title:     translated.Title,
		Content:   translated.Content,
	}
	if err := model.SaveTranslation(t); err != nil {
		common.SysError("translate: save failed: " + err.Error())
	}
	return t, nil
}

// computeSourceHash returns a short hash of the fields JSON for cache validation
func computeSourceHash(fields map[string]string) string {
	b, _ := json.Marshal(fields)
	h := sha256.Sum256(b)
	return fmt.Sprintf("%x", h[:8])
}

// TranslateContent translates arbitrary fields using LLM with DB caching + hash validation
func TranslateContent(contentType, contentId string, fields map[string]string, targetLang string) (map[string]string, error) {
	if common.TranslationChannelId == 0 || common.TranslationModel == "" {
		return fields, nil
	}

	srcHash := computeSourceHash(fields)

	// Check cache with hash validation
	cached, err := model.GetContentTranslation(contentType, contentId, targetLang)
	if err == nil && cached != nil && cached.SourceHash == srcHash {
		var result map[string]string
		if json.Unmarshal([]byte(cached.Fields), &result) == nil {
			return result, nil
		}
	}

	fieldsJSON, _ := json.Marshal(fields)
	raw, err := callLLMTranslate(string(fieldsJSON), targetLang)
	if err != nil {
		common.SysError("translateContent: " + err.Error())
		return fields, nil
	}

	var result map[string]string
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		common.SysError("translateContent: parse failed: " + err.Error())
		return fields, nil
	}

	ct := &model.ContentTranslation{
		ContentType: contentType,
		ContentId:   contentId,
		Language:    targetLang,
		Fields:      raw,
		SourceHash:  srcHash,
	}
	if err := model.SaveContentTranslation(ct); err != nil {
		common.SysError("translateContent: save failed: " + err.Error())
	}
	return result, nil
}

// TranslateItem represents a single item to translate in batch
type TranslateItem struct {
	ContentType string
	ContentId   string
	Fields      map[string]string
}

// TranslateContentBatchMerged checks cache per-item, then merges uncached items into
// as few LLM calls as possible (batches of ≤8000 chars).
func TranslateContentBatchMerged(items []TranslateItem, targetLang string) []map[string]string {
	if common.TranslationChannelId == 0 || common.TranslationModel == "" {
		results := make([]map[string]string, len(items))
		for i, item := range items {
			results[i] = item.Fields
		}
		return results
	}

	results := make([]map[string]string, len(items))
	type uncachedEntry struct {
		idx      int
		key      string
		srcHash  string
	}
	var uncached []uncachedEntry
	mergedInput := map[string]map[string]string{}

	// Phase 1: check cache
	for i, item := range items {
		srcHash := computeSourceHash(item.Fields)
		cached, err := model.GetContentTranslation(item.ContentType, item.ContentId, targetLang)
		if err == nil && cached != nil && cached.SourceHash == srcHash {
			var r map[string]string
			if json.Unmarshal([]byte(cached.Fields), &r) == nil {
				results[i] = r
				continue
			}
		}
		key := fmt.Sprintf("%s_%s", item.ContentType, item.ContentId)
		mergedInput[key] = item.Fields
		uncached = append(uncached, uncachedEntry{idx: i, key: key, srcHash: srcHash})
	}

	if len(uncached) == 0 {
		return results
	}

	// Phase 2: batch LLM calls (split if >8000 chars)
	type batch struct {
		entries []uncachedEntry
		payload map[string]map[string]string
	}
	var batches []batch
	cur := batch{payload: map[string]map[string]string{}}
	curLen := 2 // "{}"

	for _, ue := range uncached {
		entryJSON, _ := json.Marshal(mergedInput[ue.key])
		addLen := len(ue.key) + len(entryJSON) + 6 // key + value + quotes/colon/comma
		if curLen+addLen > 8000 && len(cur.entries) > 0 {
			batches = append(batches, cur)
			cur = batch{payload: map[string]map[string]string{}}
			curLen = 2
		}
		cur.entries = append(cur.entries, ue)
		cur.payload[ue.key] = mergedInput[ue.key]
		curLen += addLen
	}
	if len(cur.entries) > 0 {
		batches = append(batches, cur)
	}

	// Phase 3: call LLM per batch, parse and save
	for _, b := range batches {
		payloadJSON, _ := json.Marshal(b.payload)
		raw, err := callLLMTranslate(string(payloadJSON), targetLang)
		if err != nil {
			common.SysError("batchTranslate: " + err.Error())
			for _, ue := range b.entries {
				results[ue.idx] = items[ue.idx].Fields
			}
			continue
		}

		var parsed map[string]map[string]string
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			common.SysError("batchTranslate: parse failed: " + err.Error())
			for _, ue := range b.entries {
				results[ue.idx] = items[ue.idx].Fields
			}
			continue
		}

		for _, ue := range b.entries {
			translated, ok := parsed[ue.key]
			if !ok {
				results[ue.idx] = items[ue.idx].Fields
				continue
			}
			results[ue.idx] = translated
			fieldsJSON, _ := json.Marshal(translated)
			item := items[ue.idx]
			ct := &model.ContentTranslation{
				ContentType: item.ContentType,
				ContentId:   item.ContentId,
				Language:    targetLang,
				Fields:      string(fieldsJSON),
				SourceHash:  ue.srcHash,
			}
			model.SaveContentTranslation(ct)
		}
	}

	return results
}
