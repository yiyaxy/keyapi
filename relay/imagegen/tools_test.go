package imagegen

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
)

func withImageGenOptions(t *testing.T, enabled string, allowed string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	prev := common.OptionMap
	common.OptionMap = map[string]string{
		"image_gen.enabled":        enabled,
		"image_gen.default_model":  "gpt-image-1",
		"image_gen.allowed_models": allowed,
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = prev
		common.OptionMapRWMutex.Unlock()
	})
}

func TestInjectOpenAIToolRequiresSwitches(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "gpt-4o",
		Messages: []dto.Message{
			{Role: "user", Content: "Generate an image of a cat."},
		},
	}

	if !InjectOpenAITool(info, req) {
		t.Fatalf("expected tool injection")
	}
	if len(req.Tools) != 1 || req.Tools[0].Function.Name != GenerateImageToolName {
		t.Fatalf("unexpected tools: %#v", req.Tools)
	}
	if req.ParallelTooCalls == nil || *req.ParallelTooCalls {
		t.Fatalf("parallel_tool_calls should be forced off for injected image tool")
	}
}

func TestInjectOpenAIToolForcesParallelOffWhenCallerEnabled(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model:            "gpt-4o",
		ParallelTooCalls: common.GetPointer(true),
		Messages: []dto.Message{
			{Role: "user", Content: "Generate an image of a cat."},
		},
	}

	if !InjectOpenAITool(info, req) {
		t.Fatalf("expected tool injection")
	}
	if req.ParallelTooCalls == nil || *req.ParallelTooCalls {
		t.Fatalf("parallel_tool_calls should be forced off even when caller enabled it")
	}
}

func TestInjectOpenAIToolSkipsUnrelatedRequest(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "gpt-4o",
		Messages: []dto.Message{
			{Role: "user", Content: "Explain how Redis eviction policies work."},
		},
	}

	if InjectOpenAITool(info, req) {
		t.Fatalf("unrelated request should not inject image tool")
	}
	if len(req.Tools) != 0 || req.ParallelTooCalls != nil {
		t.Fatalf("unrelated request should remain unchanged: tools=%#v parallel=%#v", req.Tools, req.ParallelTooCalls)
	}
}

func TestInjectOpenAIToolForcesGenerateChoiceForImageRequest(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "qwen-plus",
		Messages: []dto.Message{
			{Role: "user", Content: "帮我生成一张赛博朋克风格的猫，正方形图片"},
		},
	}

	if !InjectOpenAITool(info, req) {
		t.Fatalf("expected tool injection")
	}
	if !toolChoiceForGenerate(req.ToolChoice) {
		t.Fatalf("expected forced generate_image tool choice, got %#v", req.ToolChoice)
	}
	if len(req.Messages) == 0 || !strings.Contains(req.Messages[0].StringContent(), imageToolGuidanceMarker) {
		t.Fatalf("expected image tool guidance to be prepended")
	}
}

func TestInjectOpenAIToolDoesNotForceChoiceForCapabilityQuestion(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "qwen-plus",
		Messages: []dto.Message{
			{Role: "user", Content: "现在你有生图工具吗"},
		},
	}

	if !InjectOpenAITool(info, req) {
		t.Fatalf("expected tool injection")
	}
	if req.ToolChoice != nil {
		t.Fatalf("capability question should not force a tool choice, got %#v", req.ToolChoice)
	}
	if len(req.Messages) == 0 || !strings.Contains(req.Messages[0].StringContent(), imageToolGuidanceMarker) {
		t.Fatalf("expected image tool guidance to be prepended")
	}
}

func TestInjectClaudeToolDisablesParallelUse(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatClaude,
	}
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4-5",
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: "Do you have an image generation tool?"},
		},
	}

	if !InjectClaudeTool(info, req) {
		t.Fatalf("expected tool injection")
	}
	choice, ok := req.ToolChoice.(*dto.ClaudeToolChoice)
	if !ok || choice.Type != "auto" || !choice.DisableParallelToolUse {
		t.Fatalf("parallel tool use should be disabled, got %#v", req.ToolChoice)
	}
}

func TestInjectClaudeToolSkipsUnrelatedRequest(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatClaude,
	}
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4-5",
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: "Explain how Redis eviction policies work."},
		},
	}

	if InjectClaudeTool(info, req) {
		t.Fatalf("unrelated request should not inject image tool")
	}
	if req.Tools != nil || req.ToolChoice != nil {
		t.Fatalf("unrelated request should remain unchanged: tools=%#v choice=%#v", req.Tools, req.ToolChoice)
	}
}

func TestInjectClaudeToolForcesGenerateChoiceForImageRequest(t *testing.T) {
	withImageGenOptions(t, "true", "")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatClaude,
	}
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4-5",
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: "画一张未来城市里的猫"},
		},
	}

	if !InjectClaudeTool(info, req) {
		t.Fatalf("expected tool injection")
	}
	choice, ok := req.ToolChoice.(*dto.ClaudeToolChoice)
	if !ok || choice.Type != "tool" || choice.Name != GenerateImageToolName || !choice.DisableParallelToolUse {
		t.Fatalf("expected forced generate_image tool choice, got %#v", req.ToolChoice)
	}
	if !strings.Contains(req.GetStringSystem(), imageToolGuidanceMarker) {
		t.Fatalf("expected image tool guidance in Claude system prompt")
	}
}

func TestParseGenerateArgsRejectsDisallowedModel(t *testing.T) {
	withImageGenOptions(t, "true", "gpt-image-1")
	_, err := ParseGenerateArgs(`{"prompt":"draw a house","model":"other-image-model"}`)
	if err == nil {
		t.Fatalf("expected disallowed model error")
	}
}

func TestBuildOpenAIRoundTripRequestIncludesDisplayMarkdown(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "qwen-plus",
		Messages: []dto.Message{
			{Role: "user", Content: "生成一张猫图"},
		},
	}
	next, err := BuildOpenAIRoundTripRequest(req, OpenAIToolCall{
		ID:        "call_1",
		Name:      GenerateImageToolName,
		Arguments: `{"prompt":"cat"}`,
	}, Result{
		ImageID: "img_1",
		URL:     "https://example.com/cat.png",
		Model:   "gpt-image-1",
		Prompt:  "cat",
	})
	if err != nil {
		t.Fatalf("BuildOpenAIRoundTripRequest error: %v", err)
	}
	if len(next.Messages) != 3 {
		t.Fatalf("unexpected message count %d", len(next.Messages))
	}
	content, ok := next.Messages[2].Content.(string)
	if !ok || !strings.Contains(content, "![generated image](https://example.com/cat.png)") {
		t.Fatalf("tool result should include display markdown, got %#v", next.Messages[2].Content)
	}
}

func TestOpenAIStreamCaptureSuppressesGenerateTool(t *testing.T) {
	capture := NewOpenAIStreamCapture(true)
	chunks := []string{
		`{"choices":[{"delta":{"role":"assistant"},"index":0}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"generate_image","arguments":"{\"prompt\":\""}}]},"index":0}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"cat\"}"}}]},"finish_reason":"tool_calls","index":0}]}`,
	}
	for _, chunk := range chunks {
		decision, err := capture.Handle(chunk, false)
		if err != nil {
			t.Fatalf("Handle returned error: %v", err)
		}
		if chunk != chunks[0] && decision != OpenAIStreamSuppress {
			t.Fatalf("expected suppress decision, got %v", decision)
		}
	}
	if !capture.Ready() {
		t.Fatalf("expected capture ready")
	}
	call := capture.ToolCall()
	if call.ID != "call_1" || call.Name != GenerateImageToolName || call.Arguments != `{"prompt":"cat"}` {
		t.Fatalf("unexpected call: %#v", call)
	}
}

func TestClaudeStreamCaptureBuffersThenCapturesToolUse(t *testing.T) {
	capture := NewClaudeStreamCapture(true)
	decision, err := capture.Handle(`{"type":"message_start","message":{"id":"msg_1","model":"claude"}}`, false)
	if err != nil {
		t.Fatalf("message_start error: %v", err)
	}
	if !decision.Suppress {
		t.Fatalf("message_start should be buffered")
	}
	decision, err = capture.Handle(`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"generate_image","input":{}}}`, false)
	if err != nil {
		t.Fatalf("content_block_start error: %v", err)
	}
	if !decision.Suppress || len(decision.Flush) != 0 {
		t.Fatalf("tool_use should suppress buffered events")
	}
	_, _ = capture.Handle(`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"prompt\":\"cat\"}"}}`, false)
	_, _ = capture.Handle(`{"type":"message_stop"}`, false)
	if !capture.Ready() {
		t.Fatalf("expected capture ready")
	}
	call := capture.ToolCall()
	if call.ID != "toolu_1" || call.Name != GenerateImageToolName {
		t.Fatalf("unexpected call: %#v", call)
	}
	args, err := ParseGenerateArgsAny(call.Input)
	if err != nil {
		t.Fatalf("parse args: %v", err)
	}
	if args.Prompt != "cat" {
		t.Fatalf("unexpected prompt %q", args.Prompt)
	}
}

// --- sticky-after-first-use behavior --------------------------------------

func withStickyOption(t *testing.T, value string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	prev, had := common.OptionMap["image_gen.sticky_after_first_use"]
	common.OptionMap["image_gen.sticky_after_first_use"] = value
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if had {
			common.OptionMap["image_gen.sticky_after_first_use"] = prev
		} else {
			delete(common.OptionMap, "image_gen.sticky_after_first_use")
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func TestInjectOpenAIToolStickyAfterPriorGenerateCall(t *testing.T) {
	withImageGenOptions(t, "true", "")
	withStickyOption(t, "true")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "gpt-4o",
		Messages: []dto.Message{
			{Role: "user", Content: "draw a cat"},
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"c1","type":"function","function":{"name":"generate_image","arguments":"{\"prompt\":\"cat\"}"}}]`),
			},
			{Role: "tool", ToolCallId: "c1", Content: "ok"},
			{Role: "assistant", Content: "here it is ![cat](https://e.com/c.png)"},
			// Follow-up that lacks any image keyword. Without sticky behavior
			// the tool would NOT be injected and the model would just answer
			// in words; with sticky on, the tool stays available.
			{Role: "user", Content: "再红一点"},
		},
	}

	if !InjectOpenAITool(info, req) {
		t.Fatalf("expected tool injection due to sticky history detection")
	}
	if !hasGenerateOpenAITool(req.Tools) {
		t.Fatalf("generate_image tool should be present, tools=%#v", req.Tools)
	}
}

func TestInjectOpenAIToolStickyDisabledSuppressesInjection(t *testing.T) {
	withImageGenOptions(t, "true", "")
	withStickyOption(t, "false")
	info := &relaycommon.RelayInfo{
		TokenImageGenEnabled: true,
		RelayMode:            relayconstant.RelayModeChatCompletions,
		RelayFormat:          types.RelayFormatOpenAI,
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "gpt-4o",
		Messages: []dto.Message{
			{
				Role:      "assistant",
				ToolCalls: []byte(`[{"id":"c1","type":"function","function":{"name":"generate_image","arguments":"{}"}}]`),
			},
			{Role: "user", Content: "再红一点"},
		},
	}

	if InjectOpenAITool(info, req) {
		t.Fatalf("sticky=false should not auto-inject without image keyword")
	}
}

func TestConversationHasPriorOpenAIGenerateCall(t *testing.T) {
	cases := []struct {
		name     string
		messages []dto.Message
		want     bool
	}{
		{name: "empty", want: false},
		{
			name: "no tool calls",
			messages: []dto.Message{
				{Role: "user", Content: "hi"},
				{Role: "assistant", Content: "hello"},
			},
			want: false,
		},
		{
			name: "different tool call",
			messages: []dto.Message{
				{Role: "assistant", ToolCalls: []byte(`[{"function":{"name":"web_search"}}]`)},
			},
			want: false,
		},
		{
			name: "generate_image present",
			messages: []dto.Message{
				{Role: "assistant", ToolCalls: []byte(`[{"function":{"name":"generate_image"}}]`)},
			},
			want: true,
		},
		{
			name: "generate_image only on user role is ignored",
			// Defensive: tool_calls only meaningful on assistant role.
			messages: []dto.Message{
				{Role: "user", ToolCalls: []byte(`[{"function":{"name":"generate_image"}}]`)},
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := conversationHasPriorOpenAIGenerateCall(tc.messages); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestConversationHasPriorClaudeGenerateCall(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		if conversationHasPriorClaudeGenerateCall(nil) {
			t.Fatal("expected false")
		}
	})
	t.Run("text only", func(t *testing.T) {
		msgs := []dto.ClaudeMessage{
			{Role: "user", Content: "hi"},
			{Role: "assistant", Content: "hello"},
		}
		if conversationHasPriorClaudeGenerateCall(msgs) {
			t.Fatal("expected false for text-only history")
		}
	})
	t.Run("generate tool_use present", func(t *testing.T) {
		msgs := []dto.ClaudeMessage{
			{
				Role: "assistant",
				Content: []map[string]any{
					{"type": "text", "text": "drawing"},
					{"type": "tool_use", "id": "u1", "name": "generate_image", "input": map[string]any{"prompt": "cat"}},
				},
			},
		}
		if !conversationHasPriorClaudeGenerateCall(msgs) {
			t.Fatal("expected true when tool_use generate_image exists")
		}
	})
	t.Run("different tool_use ignored", func(t *testing.T) {
		msgs := []dto.ClaudeMessage{
			{
				Role: "assistant",
				Content: []map[string]any{
					{"type": "tool_use", "id": "u1", "name": "web_search"},
				},
			},
		}
		if conversationHasPriorClaudeGenerateCall(msgs) {
			t.Fatal("expected false for unrelated tool_use")
		}
	})
}

// --- image_urls (image-to-image) -----------------------------------------

func TestParseGenerateArgsAcceptsImageURLs(t *testing.T) {
	withImageGenOptions(t, "true", "")
	args, err := ParseGenerateArgs(`{"prompt":"make it red","image_urls":["https://e.com/a.png","https://e.com/b.png"]}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(args.ImageURLs) != 2 || args.ImageURLs[0] != "https://e.com/a.png" || args.ImageURLs[1] != "https://e.com/b.png" {
		t.Fatalf("unexpected image_urls: %#v", args.ImageURLs)
	}
}

func TestSanitizeImageURLs(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{name: "nil", in: nil, want: nil},
		{name: "all empty trims to nil", in: []string{"", "  ", ""}, want: nil},
		{
			name: "trims and dedupes preserving order",
			in:   []string{" https://a/1 ", "https://a/2", "https://a/1", ""},
			want: []string{"https://a/1", "https://a/2"},
		},
		{
			name: "caps at 16",
			in: func() []string {
				s := make([]string, 20)
				for i := range s {
					s[i] = "https://e.com/" + string(rune('a'+i))
				}
				return s
			}(),
			want: nil, // assertion below checks only length
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeImageURLs(tc.in)
			if tc.name == "caps at 16" {
				if len(got) != 16 {
					t.Fatalf("expected len=16, got %d", len(got))
				}
				return
			}
			if len(got) != len(tc.want) {
				t.Fatalf("len mismatch: got %v want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("at %d got %q want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSchemaParametersIncludesImageURLsField(t *testing.T) {
	schema := schemaParameters()
	props, _ := schema["properties"].(map[string]interface{})
	if props == nil {
		t.Fatal("properties missing")
	}
	field, ok := props["image_urls"].(map[string]interface{})
	if !ok {
		t.Fatal("image_urls not in schema")
	}
	if field["type"] != "array" {
		t.Errorf("image_urls type should be array, got %v", field["type"])
	}
	if items, ok := field["items"].(map[string]interface{}); !ok || items["type"] != "string" {
		t.Errorf("image_urls items should be {type:string}, got %v", field["items"])
	}
	required, _ := schema["required"].([]string)
	for _, r := range required {
		if r == "image_urls" {
			t.Error("image_urls must not be required")
		}
	}
}
