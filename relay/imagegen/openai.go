package imagegen

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

type OpenAIToolCall struct {
	ID        string
	Name      string
	Arguments string
}

type OpenAIStreamDecision int

const (
	OpenAIStreamPass OpenAIStreamDecision = iota
	OpenAIStreamSuppress
)

type OpenAIStreamCapture struct {
	active    bool
	capturing bool
	ready     bool
	call      OpenAIToolCall
	args      strings.Builder
}

const captureArgsMaxBytes = 256 * 1024

func NewOpenAIStreamCapture(enabled bool) *OpenAIStreamCapture {
	if !enabled {
		return nil
	}
	return &OpenAIStreamCapture{active: true}
}

func (c *OpenAIStreamCapture) Handle(data string, alreadySent bool) (OpenAIStreamDecision, error) {
	if c == nil || !c.active || strings.TrimSpace(data) == "" {
		return OpenAIStreamPass, nil
	}
	if !c.capturing && !strings.Contains(data, GenerateImageToolName) {
		return OpenAIStreamPass, nil
	}
	var chunk dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
		return OpenAIStreamPass, nil
	}

	for _, choice := range chunk.Choices {
		for _, toolCall := range choice.Delta.ToolCalls {
			name := toolCall.Function.Name
			if name != "" && !IsGenerateTool(name) && !c.capturing {
				continue
			}
			if name != "" && IsGenerateTool(name) && alreadySent {
				c.active = false
				return OpenAIStreamPass, nil
			}
			if name != "" && IsGenerateTool(name) {
				c.capturing = true
				c.call.Name = name
			}
			if !c.capturing {
				continue
			}
			if toolCall.ID != "" {
				c.call.ID = toolCall.ID
			}
			if toolCall.Function.Arguments != "" {
				if c.args.Len()+len(toolCall.Function.Arguments) > captureArgsMaxBytes {
					c.active = false
					c.capturing = false
					c.ready = false
					return OpenAIStreamPass, nil
				}
				c.args.WriteString(toolCall.Function.Arguments)
			}
		}
		if choice.FinishReason != nil && *choice.FinishReason == "tool_calls" && c.capturing {
			c.ready = true
		}
	}
	if c.capturing {
		return OpenAIStreamSuppress, nil
	}
	return OpenAIStreamPass, nil
}

func (c *OpenAIStreamCapture) Ready() bool {
	return c != nil && c.ready && c.capturing
}

func (c *OpenAIStreamCapture) ToolCall() OpenAIToolCall {
	if c == nil {
		return OpenAIToolCall{}
	}
	call := c.call
	if call.ID == "" {
		call.ID = "call_" + common.GetUUID()
	}
	if call.Name == "" {
		call.Name = GenerateImageToolName
	}
	call.Arguments = c.args.String()
	return call
}

func FindOpenAIGenerateToolCall(resp *dto.OpenAITextResponse) (OpenAIToolCall, bool) {
	if resp == nil {
		return OpenAIToolCall{}, false
	}
	for _, choice := range resp.Choices {
		for _, call := range choice.Message.ParseToolCalls() {
			if IsGenerateTool(call.Function.Name) {
				id := call.ID
				if id == "" {
					id = "call_" + common.GetUUID()
				}
				return OpenAIToolCall{
					ID:        id,
					Name:      call.Function.Name,
					Arguments: call.Function.Arguments,
				}, true
			}
		}
	}
	return OpenAIToolCall{}, false
}

func BuildOpenAIRoundTripRequest(req *dto.GeneralOpenAIRequest, call OpenAIToolCall, result Result) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	next, err := common.DeepCopy(req)
	if err != nil {
		return nil, err
	}
	RemoveOpenAITool(next)
	if call.ID == "" {
		call.ID = "call_" + common.GetUUID()
	}
	if call.Name == "" {
		call.Name = GenerateImageToolName
	}
	assistant := dto.Message{
		Role:    "assistant",
		Content: nil,
	}
	assistant.SetToolCalls([]dto.ToolCallRequest{
		{
			ID:   call.ID,
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      call.Name,
				Arguments: call.Arguments,
			},
		},
	})
	resultText, err := result.ToolResultText()
	if err != nil {
		return nil, err
	}
	toolMessage := dto.Message{
		Role:       "tool",
		ToolCallId: call.ID,
		Content:    resultText,
	}
	next.Messages = append(next.Messages, assistant, toolMessage)
	return next, nil
}
