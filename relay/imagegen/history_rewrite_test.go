package imagegen

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	setting "github.com/QuantumNous/new-api/setting/imagegen"
)

var optionMutateMu sync.Mutex

func setOption(t *testing.T, key, value string) {
	t.Helper()
	optionMutateMu.Lock()
	defer optionMutateMu.Unlock()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	prev, had := common.OptionMap[key]
	common.OptionMap[key] = value
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if had {
			common.OptionMap[key] = prev
		} else {
			delete(common.OptionMap, key)
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func enableRewrite(t *testing.T) {
	setOption(t, setting.OptionRewriteHistoryImages, "true")
	setOption(t, setting.OptionEnabled, "true")
}

func chatInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayMode:            relayconstant.RelayModeChatCompletions,
		TokenImageGenEnabled: true,
	}
}

func TestRewriteOpenAIHistoryImages_LiftsPriorAssistantImage(t *testing.T) {
	enableRewrite(t)
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "user", Content: "画一只小猫"},
		{Role: "assistant", Content: "生成好了：![generated image](https://example.com/cat.png)"},
		{Role: "user", Content: "你能看到这张图吗"},
	}}

	if !RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("expected rewrite to occur")
	}

	last := req.Messages[2]
	if last.IsStringContent() {
		t.Fatalf("expected last user message upgraded to media content, got string: %v", last.Content)
	}
	parts := last.ParseContent()
	if len(parts) != 2 {
		t.Fatalf("expected 2 parts (text + image), got %d: %+v", len(parts), parts)
	}
	if parts[0].Type != dto.ContentTypeText || parts[0].Text != "你能看到这张图吗" {
		t.Errorf("text part wrong: %+v", parts[0])
	}
	if parts[1].Type != dto.ContentTypeImageURL {
		t.Errorf("expected image_url part, got: %+v", parts[1])
	}
	img := parts[1].GetImageMedia()
	if img == nil || img.Url != "https://example.com/cat.png" {
		t.Errorf("image url wrong: %+v", img)
	}
}

func TestRewriteOpenAIHistoryImages_OptOutByDefault(t *testing.T) {
	// Note: do not enable rewrite. EnabledForInfo would also matter at the
	// caller; here we test the rewrite gate specifically.
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "user", Content: "x"},
		{Role: "assistant", Content: "![g](https://e.com/a.png)"},
		{Role: "user", Content: "y"},
	}}
	if RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("rewrite must be off by default")
	}
}

func TestRewriteOpenAIHistoryImages_NoAssistantImages_NoOp(t *testing.T) {
	enableRewrite(t)
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello, no images here"},
		{Role: "user", Content: "anything?"},
	}}
	if RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("no-op when assistant turn has no markdown image")
	}
	if !req.Messages[2].IsStringContent() {
		t.Fatal("user message must remain a string when no rewrite happened")
	}
}

func TestRewriteOpenAIHistoryImages_DedupesAlreadyAttachedURL(t *testing.T) {
	enableRewrite(t)
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "assistant", Content: "![g](https://e.com/x.png)"},
		{Role: "user", Content: []any{
			map[string]any{"type": "text", "text": "describe it"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://e.com/x.png"}},
		}},
	}}
	if RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("must not re-add an image URL the user already attached")
	}
}

func TestRewriteOpenAIHistoryImages_MultipleImagesDedupedWithinAssistant(t *testing.T) {
	enableRewrite(t)
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "user", Content: "draw two cats"},
		{Role: "assistant", Content: "first ![a](https://e.com/1.png) second ![b](https://e.com/2.png) repeated ![a](https://e.com/1.png)"},
		{Role: "user", Content: "compare them"},
	}}
	if !RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("expected rewrite")
	}
	parts := req.Messages[2].ParseContent()
	imgCount := 0
	for _, p := range parts {
		if p.Type == dto.ContentTypeImageURL {
			imgCount++
		}
	}
	if imgCount != 2 {
		t.Fatalf("expected 2 unique images, got %d (parts=%+v)", imgCount, parts)
	}
}

func TestRewriteOpenAIHistoryImages_OnlyMostRecentAssistantTurnLifted(t *testing.T) {
	enableRewrite(t)
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "user", Content: "first request"},
		{Role: "assistant", Content: "old image ![old](https://e.com/old.png)"},
		{Role: "user", Content: "another request"},
		{Role: "assistant", Content: "new image ![new](https://e.com/new.png)"},
		{Role: "user", Content: "describe the latest"},
	}}
	if !RewriteOpenAIHistoryImages(chatInfo(), req) {
		t.Fatal("expected rewrite")
	}
	parts := req.Messages[len(req.Messages)-1].ParseContent()
	urls := []string{}
	for _, p := range parts {
		if p.Type == dto.ContentTypeImageURL {
			if img := p.GetImageMedia(); img != nil {
				urls = append(urls, img.Url)
			}
		}
	}
	if len(urls) != 1 || urls[0] != "https://e.com/new.png" {
		t.Fatalf("only the most recent assistant turn's image should be lifted, got %v", urls)
	}
}

func TestRewriteOpenAIHistoryImages_TokenImageGenDisabled_NoOp(t *testing.T) {
	enableRewrite(t)
	info := chatInfo()
	info.TokenImageGenEnabled = false
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "assistant", Content: "![g](https://e.com/a.png)"},
		{Role: "user", Content: "?"},
	}}
	if RewriteOpenAIHistoryImages(info, req) {
		t.Fatal("must respect token-level imagegen flag")
	}
}

func TestRewriteOpenAIHistoryImages_NonChatMode_NoOp(t *testing.T) {
	enableRewrite(t)
	info := chatInfo()
	info.RelayMode = relayconstant.RelayModeCompletions
	req := &dto.GeneralOpenAIRequest{Messages: []dto.Message{
		{Role: "assistant", Content: "![g](https://e.com/a.png)"},
		{Role: "user", Content: "?"},
	}}
	if RewriteOpenAIHistoryImages(info, req) {
		t.Fatal("only chat completions mode should be rewritten")
	}
}
