package imagegen

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	setting "github.com/QuantumNous/new-api/setting/imagegen"
	"github.com/QuantumNous/new-api/types"
)

const GenerateImageToolName = "generate_image"

const imageToolGuidanceMarker = "NEW_API_IMAGE_GENERATION_TOOL_GUIDANCE"

const imageToolGuidance = imageToolGuidanceMarker + `
You have access to generate_image for real image generation.
- If the user asks to generate, draw, render, design, create, or make an image, picture, icon, avatar, poster, wallpaper, logo, or illustration, call generate_image instead of only writing a prompt or saying you created one.
- If the user only asks whether image generation is available, answer that it is available when requested, but do not claim that an image has already been generated.
- Do not claim an image was generated unless generate_image returned a URL or data URL.
- After generate_image returns display_markdown, include that Markdown image exactly in the final answer so the user can see the image.
- For edit / variation / "make it X" follow-ups about an image you previously generated or the user attached, pass the source image URL(s) via image_urls so the model can actually condition on them. Up to 16 URLs; png/webp/jpg only.
- Reply in the user's language.`

type GenerateArgs struct {
	Prompt    string   `json:"prompt"`
	Model     string   `json:"model,omitempty"`
	Size      string   `json:"size,omitempty"`
	Quality   string   `json:"quality,omitempty"`
	N         uint     `json:"n,omitempty"`
	ImageURLs []string `json:"image_urls,omitempty"`
}

func EnabledForInfo(info *relaycommon.RelayInfo) bool {
	return info != nil && info.TokenImageGenEnabled && setting.Enabled()
}

func IsGenerateTool(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), GenerateImageToolName)
}

func InjectTools(info *relaycommon.RelayInfo, request dto.Request) bool {
	if !EnabledForInfo(info) {
		return false
	}
	if info.RelayMode != relayconstant.RelayModeChatCompletions {
		return false
	}
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		injected := InjectOpenAITool(info, req)
		// History rewrite is independent of tool injection: even when this
		// turn isn't an image-related ask, prior assistant images may still
		// need to be lifted into vision input so the model can answer
		// follow-ups about them.
		rewritten := RewriteOpenAIHistoryImages(info, req)
		return injected || rewritten
	case *dto.ClaudeRequest:
		return InjectClaudeTool(info, req)
	default:
		return false
	}
}

func InjectOpenAITool(info *relaycommon.RelayInfo, req *dto.GeneralOpenAIRequest) bool {
	if req == nil || !EnabledForInfo(info) {
		return false
	}
	if !shouldAllowOpenAIToolChoice(req.ToolChoice) || hasGenerateOpenAITool(req.Tools) {
		return false
	}
	userText := lastOpenAIUserText(req)
	wantsImage := wantsImageGenerationRequest(userText)
	imageRelated := mentionsImageGenerationTopic(userText) ||
		wantsImage ||
		toolChoiceForGenerate(req.ToolChoice) ||
		(setting.StickyAfterFirstUseEnabled() && conversationHasPriorOpenAIGenerateCall(req.Messages))
	if !imageRelated {
		return false
	}
	req.Tools = append(req.Tools, dto.ToolCallRequest{
		Type: "function",
		Function: dto.FunctionRequest{
			Name:        GenerateImageToolName,
			Description: "Generate a real image from a detailed text prompt. Use this when the user asks to create, draw, render, design, make, or generate an image. Do not use it for capability questions; just answer that image generation is available.",
			Parameters:  schemaParameters(),
		},
	})
	ensureOpenAIImageToolGuidance(req)
	if wantsImage && canForceOpenAIGenerateTool(req.ToolChoice) {
		req.ToolChoice = dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name: GenerateImageToolName,
			},
		}
	}
	req.ParallelTooCalls = common.GetPointer(false)
	return true
}

func InjectClaudeTool(info *relaycommon.RelayInfo, req *dto.ClaudeRequest) bool {
	if req == nil || !EnabledForInfo(info) {
		return false
	}
	if !shouldAllowClaudeToolChoice(req.ToolChoice) || hasClaudeTool(req.GetTools(), GenerateImageToolName) {
		return false
	}
	userText := lastClaudeUserText(req)
	wantsImage := wantsImageGenerationRequest(userText)
	imageRelated := mentionsImageGenerationTopic(userText) ||
		wantsImage ||
		claudeToolChoiceForGenerate(req.ToolChoice) ||
		(setting.StickyAfterFirstUseEnabled() && conversationHasPriorClaudeGenerateCall(req.Messages))
	if !imageRelated {
		return false
	}
	req.AddTool(dto.Tool{
		Name:        GenerateImageToolName,
		Description: "Generate a real image from a detailed text prompt. Use this when the user asks to create, draw, render, design, make, or generate an image. Do not use it for capability questions; just answer that image generation is available.",
		InputSchema: schemaParameters(),
	})
	ensureClaudeImageToolGuidance(req)
	if wantsImage && canForceClaudeGenerateTool(req.ToolChoice) {
		req.ToolChoice = &dto.ClaudeToolChoice{
			Type:                   "tool",
			Name:                   GenerateImageToolName,
			DisableParallelToolUse: true,
		}
	} else {
		disableClaudeParallelToolUse(req)
	}
	return true
}

func RemoveOpenAITool(req *dto.GeneralOpenAIRequest) {
	if req == nil {
		return
	}
	filtered := make([]dto.ToolCallRequest, 0, len(req.Tools))
	for _, tool := range req.Tools {
		if !IsGenerateTool(tool.Function.Name) {
			filtered = append(filtered, tool)
		}
	}
	req.Tools = filtered
	if toolChoiceForGenerate(req.ToolChoice) {
		req.ToolChoice = nil
	}
}

func RemoveClaudeTool(req *dto.ClaudeRequest) {
	if req == nil {
		return
	}
	tools := req.GetTools()
	filtered := make([]any, 0, len(tools))
	for _, tool := range tools {
		if !claudeToolNameMatches(tool, GenerateImageToolName) {
			filtered = append(filtered, tool)
		}
	}
	if len(filtered) == 0 {
		req.Tools = nil
	} else {
		req.Tools = filtered
	}
	if claudeToolChoiceForGenerate(req.ToolChoice) {
		req.ToolChoice = nil
	}
}

func ParseGenerateArgs(raw string) (GenerateArgs, error) {
	var args GenerateArgs
	if strings.TrimSpace(raw) == "" {
		return args, fmt.Errorf("generate_image arguments are empty")
	}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return args, err
	}
	return normalizeGenerateArgs(args)
}

func ParseGenerateArgsAny(input any) (GenerateArgs, error) {
	var args GenerateArgs
	if input == nil {
		return args, fmt.Errorf("generate_image arguments are empty")
	}
	data, err := common.Marshal(input)
	if err != nil {
		return args, err
	}
	if err := common.Unmarshal(data, &args); err != nil {
		return args, err
	}
	return normalizeGenerateArgs(args)
}

func normalizeGenerateArgs(args GenerateArgs) (GenerateArgs, error) {
	args.Prompt = strings.TrimSpace(args.Prompt)
	args.Model = strings.TrimSpace(args.Model)
	args.Size = strings.TrimSpace(args.Size)
	args.Quality = strings.TrimSpace(args.Quality)
	if args.Prompt == "" {
		return args, fmt.Errorf("generate_image prompt is required")
	}
	if args.Model == "" {
		args.Model = setting.DefaultImageModel()
	}
	if !setting.IsAllowedModel(args.Model) {
		return args, fmt.Errorf("image model %q is not allowed", args.Model)
	}
	if args.N == 0 {
		args.N = 1
	}
	if args.N > 4 {
		args.N = 4
	}
	args.ImageURLs = sanitizeImageURLs(args.ImageURLs)
	return args, nil
}

// sanitizeImageURLs trims, drops empty entries, dedupes (preserving order),
// and caps at 16. We don't validate the scheme here — the upstream image API
// is the source of truth on what it accepts; rejecting locally would just
// surface confusing errors to the model when an upstream might actually have
// accepted the URL.
func sanitizeImageURLs(urls []string) []string {
	if len(urls) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(urls))
	out := make([]string, 0, len(urls))
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if _, dup := seen[u]; dup {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
		if len(out) >= 16 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func ensureOpenAIImageToolGuidance(req *dto.GeneralOpenAIRequest) {
	if req == nil || openAIRequestHasGuidance(req) {
		return
	}
	req.Messages = append([]dto.Message{
		{
			Role:    req.GetSystemRoleName(),
			Content: imageToolGuidance,
		},
	}, req.Messages...)
}

func openAIRequestHasGuidance(req *dto.GeneralOpenAIRequest) bool {
	if req == nil {
		return false
	}
	for _, message := range req.Messages {
		if strings.Contains(message.StringContent(), imageToolGuidanceMarker) {
			return true
		}
	}
	return false
}

func ensureClaudeImageToolGuidance(req *dto.ClaudeRequest) {
	if req == nil || claudeRequestHasGuidance(req) {
		return
	}
	if req.System == nil {
		req.SetStringSystem(imageToolGuidance)
		return
	}
	if req.IsStringSystem() {
		existing := strings.TrimSpace(req.GetStringSystem())
		if existing == "" {
			req.SetStringSystem(imageToolGuidance)
		} else {
			req.SetStringSystem(imageToolGuidance + "\n" + existing)
		}
		return
	}
	guidance := dto.ClaudeMediaMessage{Type: dto.ContentTypeText}
	guidance.SetText(imageToolGuidance)
	system := req.ParseSystem()
	if len(system) == 0 {
		req.System = []dto.ClaudeMediaMessage{guidance}
		return
	}
	req.System = append([]dto.ClaudeMediaMessage{guidance}, system...)
}

func claudeRequestHasGuidance(req *dto.ClaudeRequest) bool {
	if req == nil || req.System == nil {
		return false
	}
	data, _ := common.Marshal(req.System)
	return strings.Contains(string(data), imageToolGuidanceMarker)
}

func lastOpenAIUserText(req *dto.GeneralOpenAIRequest) string {
	if req == nil {
		return ""
	}
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if strings.EqualFold(req.Messages[i].Role, "user") {
			return strings.TrimSpace(req.Messages[i].StringContent())
		}
	}
	return ""
}

func lastClaudeUserText(req *dto.ClaudeRequest) string {
	if req == nil {
		return ""
	}
	for i := len(req.Messages) - 1; i >= 0; i-- {
		message := req.Messages[i]
		if !strings.EqualFold(message.Role, "user") {
			continue
		}
		if message.IsStringContent() {
			return strings.TrimSpace(message.GetStringContent())
		}
		content, _ := message.ParseContent()
		var parts []string
		for _, item := range content {
			if item.Type == dto.ContentTypeText {
				parts = append(parts, item.GetText())
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	}
	return ""
}

func mentionsImageGenerationTopic(text string) bool {
	text = strings.TrimSpace(strings.ToLower(text))
	if text == "" {
		return false
	}
	return containsAny(text, []string{
		"生图", "出图", "图片", "图像", "照片", "头像", "壁纸", "海报", "插画", "图标", "封面", "表情包",
		"image", "picture", "photo", "avatar", "poster", "wallpaper", "illustration", "logo", "icon",
	})
}

func wantsImageGenerationRequest(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" || isImageCapabilityQuestion(text) {
		return false
	}
	lower := strings.ToLower(text)
	if containsAny(lower, []string{
		"帮我生成", "给我生成", "请生成", "生成一张", "生成一个", "生成图片", "生成图像", "生成照片",
		"帮我画", "给我画", "请画", "画一张", "画一个", "绘制", "设计一张", "设计一个",
		"制作一张", "制作一个", "做一张", "做一个", "创建一张", "创建一个", "出一张", "来一张",
		"帮我生图", "给我生图", "直接生图",
	}) {
		return true
	}
	if containsAny(lower, []string{"generate", "create", "draw", "render", "make", "design"}) &&
		containsAny(lower, []string{"image", "picture", "photo", "avatar", "poster", "wallpaper", "illustration", "logo", "icon"}) {
		return true
	}
	if containsAny(lower, []string{"生成", "画", "绘制", "设计", "制作", "创建"}) &&
		containsAny(lower, []string{"图", "图片", "图像", "照片", "头像", "壁纸", "海报", "插画", "图标", "封面", "表情包", "logo"}) {
		return true
	}
	return false
}

func isImageCapabilityQuestion(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))
	if lower == "" {
		return false
	}
	if containsAny(lower, []string{"帮我", "给我", "请", "for me", "of a ", "of an ", "with "}) {
		return false
	}
	if !strings.ContainsAny(lower, "吗?？") {
		return false
	}
	return containsAny(lower, []string{
		"有生图", "生图工具", "图片生成工具", "能生成", "可以生成", "能不能生成", "会不会生成", "是否支持",
		"do you have", "can you generate", "could you generate", "are you able to generate", "support image generation",
	})
}

func canForceOpenAIGenerateTool(toolChoice any) bool {
	if toolChoice == nil {
		return true
	}
	if toolChoiceForGenerate(toolChoice) {
		return false
	}
	if choice, ok := toolChoice.(string); ok {
		choice = strings.TrimSpace(strings.ToLower(choice))
		return choice == "" || choice == "auto" || choice == "required"
	}
	return false
}

func canForceClaudeGenerateTool(toolChoice any) bool {
	if toolChoice == nil {
		return true
	}
	if claudeToolChoiceForGenerate(toolChoice) {
		return false
	}
	if choice, ok := toolChoice.(string); ok {
		choice = strings.TrimSpace(strings.ToLower(choice))
		return choice == "" || choice == "auto" || choice == "any"
	}
	if choice, ok := toolChoice.(*dto.ClaudeToolChoice); ok {
		return choice != nil && (choice.Type == "" || choice.Type == "auto" || choice.Type == "any")
	}
	if choice, ok := toolChoice.(dto.ClaudeToolChoice); ok {
		return choice.Type == "" || choice.Type == "auto" || choice.Type == "any"
	}
	return false
}

func containsAny(text string, needles []string) bool {
	for _, needle := range needles {
		if needle != "" && strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func schemaParameters() map[string]interface{} {
	props := map[string]interface{}{
		"prompt": map[string]interface{}{
			"type":        "string",
			"description": "A complete, detailed image prompt including subject, composition, style, colors, and constraints.",
		},
		"model": map[string]interface{}{
			"type":        "string",
			"description": "Optional image generation model. Omit to use the system default.",
		},
		"size": map[string]interface{}{
			"type":        "string",
			"description": "Optional output size such as 1024x1024, 1024x1536, 1536x1024, 512x512, or 256x256.",
		},
		"quality": map[string]interface{}{
			"type":        "string",
			"description": "Optional quality hint such as auto, low, medium, high, standard, or hd.",
		},
		"n": map[string]interface{}{
			"type":        "integer",
			"description": "Number of images to generate.",
			"minimum":     1,
			"maximum":     4,
		},
		"image_urls": map[string]interface{}{
			"type":        "array",
			"items":       map[string]interface{}{"type": "string"},
			"description": "Optional reference / source images (https URLs to png, webp, or jpg files, each <50MB). Up to 16. Use this for edits, variations, or style/identity transfer based on a previously generated or user-attached image. Omit for pure text-to-image.",
			"maxItems":    16,
		},
	}
	if allowed := setting.AllowedModels(); len(allowed) > 0 {
		props["model"].(map[string]interface{})["enum"] = allowed
	}
	return map[string]interface{}{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           props,
		"required":             []string{"prompt"},
	}
}

func shouldAllowOpenAIToolChoice(toolChoice any) bool {
	if toolChoice == nil {
		return true
	}
	if choice, ok := toolChoice.(string); ok {
		return choice == "" || choice == "auto" || choice == "required"
	}
	if toolChoiceForGenerate(toolChoice) {
		return true
	}
	return false
}

func toolChoiceForGenerate(toolChoice any) bool {
	if toolChoice == nil {
		return false
	}
	switch choice := toolChoice.(type) {
	case map[string]interface{}:
		if fn, ok := choice["function"].(map[string]interface{}); ok {
			return IsGenerateTool(common.Interface2String(fn["name"]))
		}
	case dto.ToolCallRequest:
		return IsGenerateTool(choice.Function.Name)
	case *dto.ToolCallRequest:
		return choice != nil && IsGenerateTool(choice.Function.Name)
	}
	data, _ := common.Marshal(toolChoice)
	var parsed struct {
		Function struct {
			Name string `json:"name"`
		} `json:"function"`
	}
	_ = common.Unmarshal(data, &parsed)
	return IsGenerateTool(parsed.Function.Name)
}

func shouldAllowClaudeToolChoice(toolChoice any) bool {
	if toolChoice == nil {
		return true
	}
	if choice, ok := toolChoice.(string); ok {
		return choice == "" || choice == "auto" || choice == "any"
	}
	if choice, ok := toolChoice.(*dto.ClaudeToolChoice); ok {
		return choice == nil || choice.Type == "auto" || choice.Type == "any" || (choice.Type == "tool" && IsGenerateTool(choice.Name))
	}
	if choice, ok := toolChoice.(dto.ClaudeToolChoice); ok {
		return choice.Type == "auto" || choice.Type == "any" || (choice.Type == "tool" && IsGenerateTool(choice.Name))
	}
	return claudeToolChoiceForGenerate(toolChoice)
}

func disableClaudeParallelToolUse(req *dto.ClaudeRequest) {
	if req == nil {
		return
	}
	switch choice := req.ToolChoice.(type) {
	case nil:
		req.ToolChoice = &dto.ClaudeToolChoice{Type: "auto", DisableParallelToolUse: true}
	case *dto.ClaudeToolChoice:
		if choice != nil && choice.Type != "none" {
			choice.DisableParallelToolUse = true
		}
	case dto.ClaudeToolChoice:
		if choice.Type != "none" {
			choice.DisableParallelToolUse = true
			req.ToolChoice = choice
		}
	case map[string]interface{}:
		if common.Interface2String(choice["type"]) != "none" {
			choice["disable_parallel_tool_use"] = true
		}
	case string:
		if choice != "none" {
			toolType := choice
			if toolType == "" {
				toolType = "auto"
			}
			req.ToolChoice = &dto.ClaudeToolChoice{Type: toolType, DisableParallelToolUse: true}
		}
	default:
		data, _ := common.Marshal(choice)
		var parsed dto.ClaudeToolChoice
		if err := common.Unmarshal(data, &parsed); err == nil && parsed.Type != "" && parsed.Type != "none" {
			parsed.DisableParallelToolUse = true
			req.ToolChoice = parsed
		}
	}
}

func claudeToolChoiceForGenerate(toolChoice any) bool {
	data, _ := common.Marshal(toolChoice)
	var parsed dto.ClaudeToolChoice
	_ = common.Unmarshal(data, &parsed)
	return parsed.Type == "tool" && IsGenerateTool(parsed.Name)
}

// conversationHasPriorOpenAIGenerateCall returns true when any prior
// assistant message in the conversation already issued a generate_image
// tool_call. We scan only assistant messages because tool_calls live on the
// assistant side; user/tool messages are irrelevant. Used by the "sticky"
// behavior so the tool stays available for natural follow-ups like
// "再红一点" / "把背景换掉" that don't trigger the keyword detector.
func conversationHasPriorOpenAIGenerateCall(messages []dto.Message) bool {
	for i := range messages {
		if messages[i].Role != "assistant" {
			continue
		}
		for _, tc := range messages[i].ParseToolCalls() {
			if IsGenerateTool(tc.Function.Name) {
				return true
			}
		}
	}
	return false
}

// conversationHasPriorClaudeGenerateCall is the Claude-side equivalent.
// Claude embeds tool_use as a content block with type=="tool_use" rather
// than as a separate field, so we walk parsed content of every assistant
// message looking for that block.
func conversationHasPriorClaudeGenerateCall(messages []dto.ClaudeMessage) bool {
	for i := range messages {
		if messages[i].Role != "assistant" {
			continue
		}
		parts, err := messages[i].ParseContent()
		if err != nil {
			continue
		}
		for _, part := range parts {
			if part.Type == "tool_use" && IsGenerateTool(part.Name) {
				return true
			}
		}
	}
	return false
}

func hasGenerateOpenAITool(tools []dto.ToolCallRequest) bool {
	for _, tool := range tools {
		if IsGenerateTool(tool.Function.Name) {
			return true
		}
	}
	return false
}

func hasClaudeTool(tools []any, name string) bool {
	for _, tool := range tools {
		if claudeToolNameMatches(tool, name) {
			return true
		}
	}
	return false
}

func claudeToolNameMatches(tool any, name string) bool {
	switch t := tool.(type) {
	case dto.Tool:
		return strings.EqualFold(t.Name, name)
	case *dto.Tool:
		return t != nil && strings.EqualFold(t.Name, name)
	default:
		data, _ := common.Marshal(tool)
		var parsed struct {
			Name string `json:"name"`
		}
		_ = common.Unmarshal(data, &parsed)
		return strings.EqualFold(parsed.Name, name)
	}
}

func RelayFormatSupportsImageTools(format types.RelayFormat) bool {
	return format == types.RelayFormatOpenAI || format == types.RelayFormatClaude
}
