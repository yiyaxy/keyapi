package imagegen

import (
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	setting "github.com/QuantumNous/new-api/setting/imagegen"
)

// URLResolver, given a URL pulled out of a generated-image Markdown block,
// returns the best URL to hand to a vision model right now. It exists so the
// rewrite layer can transparently swap our internal `/public/images/async/...`
// proxy URL for a fresh OSS direct presigned URL, saving the model an extra
// HTTP hop and refreshing the TTL window. Returning the input unchanged is
// always a safe fallback.
type URLResolver func(rawURL string) string

var urlResolver URLResolver = func(s string) string { return s }

// RegisterURLResolver lets the outer relay package (which has access to the
// task model and storage client) supply a smarter resolver. Calling with nil
// is a no-op so tests can clear/restore freely.
func RegisterURLResolver(r URLResolver) {
	if r == nil {
		urlResolver = func(s string) string { return s }
		return
	}
	urlResolver = r
}

// markdownImageRegex captures the URL portion of a Markdown image syntax
// `![alt](url)`. It tolerates an optional title segment after the URL inside
// the parentheses but does not try to parse arbitrary URL escape sequences;
// the URLs we generate are pre-escaped already.
var markdownImageRegex = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)`)

// RewriteOpenAIHistoryImages augments the most recent user message with
// `image_url` content blocks pointing at images the assistant produced in the
// immediately-preceding assistant turn. This bridges the gap that OpenAI
// chat.completions tool results are string-only — without this, a vision model
// can read the image URL as text but cannot actually see the pixels.
//
// Returns true if the request was modified.
//
// Scope decisions (intentional MVP):
//   - Only the most recent assistant turn's images are lifted. Reaching
//     further back inflates prompt tokens for marginal benefit, and the
//     "I just generated this, look at it" follow-up is the dominant case.
//   - Images already present anywhere in the latest user message are not
//     re-added (dedupe by URL string).
//   - If no qualifying assistant images exist, the request is left untouched.
func RewriteOpenAIHistoryImages(info *relaycommon.RelayInfo, req *dto.GeneralOpenAIRequest) bool {
	if req == nil || info == nil {
		return false
	}
	if !setting.RewriteHistoryImagesEnabled() {
		return false
	}
	if !info.TokenImageGenEnabled {
		return false
	}
	if info.RelayMode != relayconstant.RelayModeChatCompletions {
		return false
	}
	if len(req.Messages) < 2 {
		return false
	}

	userIdx := lastUserMessageIndex(req.Messages)
	if userIdx <= 0 {
		return false
	}
	assistantIdx := lastAssistantMessageBefore(req.Messages, userIdx)
	if assistantIdx < 0 {
		return false
	}

	urls := extractMarkdownImageURLs(req.Messages[assistantIdx].StringContent())
	if len(urls) == 0 {
		return false
	}

	resolved := make([]string, 0, len(urls))
	for _, u := range urls {
		r := strings.TrimSpace(urlResolver(u))
		if r == "" {
			r = u
		}
		resolved = append(resolved, r)
	}

	existing := collectImageURLs(&req.Messages[userIdx])
	final := filterNew(resolved, existing)
	if len(final) == 0 {
		return false
	}

	appendImageURLsToMessage(&req.Messages[userIdx], final)
	return true
}

func lastUserMessageIndex(messages []dto.Message) int {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return i
		}
	}
	return -1
}

func lastAssistantMessageBefore(messages []dto.Message, before int) int {
	for i := before - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" {
			return i
		}
	}
	return -1
}

func extractMarkdownImageURLs(text string) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	matches := markdownImageRegex.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		url := strings.TrimSpace(m[1])
		if url == "" {
			continue
		}
		if _, dup := seen[url]; dup {
			continue
		}
		seen[url] = struct{}{}
		out = append(out, url)
	}
	return out
}

// collectImageURLs returns every image_url URL already present in the message
// content, so we don't add the same image twice when the caller (or a previous
// rewrite pass) has already attached it.
func collectImageURLs(m *dto.Message) map[string]struct{} {
	urls := make(map[string]struct{})
	if m == nil || m.IsStringContent() {
		return urls
	}
	for _, part := range m.ParseContent() {
		if part.Type != dto.ContentTypeImageURL {
			continue
		}
		img := part.GetImageMedia()
		if img == nil || img.Url == "" {
			continue
		}
		urls[img.Url] = struct{}{}
	}
	return urls
}

func filterNew(candidates []string, existing map[string]struct{}) []string {
	out := make([]string, 0, len(candidates))
	for _, url := range candidates {
		if _, dup := existing[url]; dup {
			continue
		}
		existing[url] = struct{}{}
		out = append(out, url)
	}
	return out
}

func appendImageURLsToMessage(m *dto.Message, urls []string) {
	if m == nil || len(urls) == 0 {
		return
	}
	var parts []dto.MediaContent
	if m.IsStringContent() {
		text := m.StringContent()
		if strings.TrimSpace(text) != "" {
			parts = append(parts, dto.MediaContent{Type: dto.ContentTypeText, Text: text})
		}
	} else {
		parts = append(parts, m.ParseContent()...)
	}
	for _, url := range urls {
		parts = append(parts, dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: &dto.MessageImageUrl{Url: url},
		})
	}
	m.SetMediaContent(parts)
}
