package imagegen

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

type ClaudeToolCall struct {
	ID      string
	Name    string
	Input   any
	RawJSON string
}

type ClaudeStreamDecision struct {
	Suppress bool
	Flush    []string
}

type ClaudeStreamCapture struct {
	active       bool
	buffer       []string
	capturing    bool
	ready        bool
	call         ClaudeToolCall
	partialInput strings.Builder
}

func NewClaudeStreamCapture(enabled bool) *ClaudeStreamCapture {
	if !enabled {
		return nil
	}
	return &ClaudeStreamCapture{active: true}
}

func (c *ClaudeStreamCapture) Handle(data string, alreadySent bool) (ClaudeStreamDecision, error) {
	if c == nil || !c.active || strings.TrimSpace(data) == "" {
		return ClaudeStreamDecision{}, nil
	}
	if !c.capturing && len(c.buffer) == 0 && !strings.Contains(data, GenerateImageToolName) && !strings.Contains(data, "message_start") {
		return ClaudeStreamDecision{}, nil
	}
	var event dto.ClaudeResponse
	if err := common.UnmarshalJsonStr(data, &event); err != nil {
		return ClaudeStreamDecision{}, nil
	}

	if c.capturing {
		c.captureClaudeEvent(&event)
		return ClaudeStreamDecision{Suppress: true}, nil
	}

	switch event.Type {
	case "message_start":
		if c.bufferedBytes()+len(data) > captureArgsMaxBytes {
			return c.flushWith(data), nil
		}
		c.buffer = append(c.buffer, data)
		return ClaudeStreamDecision{Suppress: true}, nil
	case "content_block_start":
		if event.ContentBlock != nil && event.ContentBlock.Type == "tool_use" && IsGenerateTool(event.ContentBlock.Name) {
			if alreadySent {
				c.active = false
				flush := append([]string{}, c.buffer...)
				c.buffer = nil
				return ClaudeStreamDecision{Flush: flush}, nil
			}
			c.capturing = true
			c.call.ID = event.ContentBlock.Id
			c.call.Name = event.ContentBlock.Name
			c.call.Input = event.ContentBlock.Input
			c.buffer = nil
			return ClaudeStreamDecision{Suppress: true}, nil
		}
		return c.flushWith(data), nil
	default:
		if len(c.buffer) > 0 {
			return c.flushWith(data), nil
		}
	}
	return ClaudeStreamDecision{}, nil
}

func (c *ClaudeStreamCapture) bufferedBytes() int {
	total := 0
	for _, s := range c.buffer {
		total += len(s)
	}
	return total
}

func (c *ClaudeStreamCapture) captureClaudeEvent(event *dto.ClaudeResponse) {
	if event == nil {
		return
	}
	switch event.Type {
	case "content_block_delta":
		if event.Delta != nil && event.Delta.PartialJson != nil {
			delta := *event.Delta.PartialJson
			if c.partialInput.Len()+len(delta) > captureArgsMaxBytes {
				c.active = false
				c.capturing = false
				c.ready = false
				return
			}
			c.partialInput.WriteString(delta)
		}
	case "message_stop":
		c.ready = true
	case "message_delta":
		if event.Delta != nil && event.Delta.StopReason != nil && *event.Delta.StopReason == "tool_use" {
			c.ready = true
		}
	}
}

func (c *ClaudeStreamCapture) flushWith(data string) ClaudeStreamDecision {
	flush := append([]string{}, c.buffer...)
	c.buffer = nil
	if data != "" {
		flush = append(flush, data)
	}
	return ClaudeStreamDecision{Flush: flush}
}

func (c *ClaudeStreamCapture) Ready() bool {
	return c != nil && c.ready && c.capturing
}

func (c *ClaudeStreamCapture) ToolCall() ClaudeToolCall {
	if c == nil {
		return ClaudeToolCall{}
	}
	call := c.call
	if call.ID == "" {
		call.ID = "toolu_" + common.GetUUID()
	}
	if call.Name == "" {
		call.Name = GenerateImageToolName
	}
	raw := c.partialInput.String()
	if raw != "" {
		call.RawJSON = raw
		var input map[string]any
		_ = common.Unmarshal([]byte(raw), &input)
		call.Input = input
	} else {
		data, _ := common.Marshal(call.Input)
		call.RawJSON = string(data)
	}
	return call
}

func FindClaudeGenerateToolCall(resp *dto.ClaudeResponse) (ClaudeToolCall, bool) {
	if resp == nil {
		return ClaudeToolCall{}, false
	}
	for _, content := range resp.Content {
		if content.Type == "tool_use" && IsGenerateTool(content.Name) {
			id := content.Id
			if id == "" {
				id = "toolu_" + common.GetUUID()
			}
			return ClaudeToolCall{
				ID:    id,
				Name:  content.Name,
				Input: content.Input,
			}, true
		}
	}
	return ClaudeToolCall{}, false
}

func BuildClaudeRoundTripRequest(req *dto.ClaudeRequest, call ClaudeToolCall, result Result) (*dto.ClaudeRequest, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	next, err := common.DeepCopy(req)
	if err != nil {
		return nil, err
	}
	RemoveClaudeTool(next)
	if call.ID == "" {
		call.ID = "toolu_" + common.GetUUID()
	}
	if call.Name == "" {
		call.Name = GenerateImageToolName
	}
	assistant := dto.ClaudeMessage{
		Role: "assistant",
		Content: []dto.ClaudeMediaMessage{
			{
				Type:  "tool_use",
				Id:    call.ID,
				Name:  call.Name,
				Input: call.Input,
			},
		},
	}
	resultText, err := result.ToolResultText()
	if err != nil {
		return nil, err
	}
	resultContent := []dto.ClaudeMediaMessage{
		{
			Type: "text",
			Text: common.GetPointer(resultText),
		},
	}
	if result.URL != "" {
		resultContent = append(resultContent, dto.ClaudeMediaMessage{
			Type: "image",
			Source: &dto.ClaudeMessageSource{
				Type: "url",
				Url:  result.URL,
			},
		})
	} else if result.B64JSON != "" {
		resultContent = append(resultContent, dto.ClaudeMediaMessage{
			Type: "image",
			Source: &dto.ClaudeMessageSource{
				Type:      "base64",
				MediaType: result.MimeType,
				Data:      result.B64JSON,
			},
		})
	}
	user := dto.ClaudeMessage{
		Role: "user",
		Content: []dto.ClaudeMediaMessage{
			{
				Type:      "tool_result",
				ToolUseId: call.ID,
				Content:   resultContent,
			},
		},
	}
	next.Messages = append(next.Messages, assistant, user)
	return next, nil
}
