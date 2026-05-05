package imagegen

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type Result struct {
	ImageID       string `json:"image_id"`
	TaskID        string `json:"task_id,omitempty"`
	TaskURL       string `json:"task_url,omitempty"`
	Status        string `json:"status,omitempty"`
	URL           string `json:"url,omitempty"`
	B64JSON       string `json:"b64_json,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	RevisedPrompt string `json:"revised_prompt,omitempty"`
	Model         string `json:"model"`
	Prompt        string `json:"prompt"`
}

const StatusSentContextKey = "imagegen_status_sent"

func (r Result) DataURL() string {
	if r.B64JSON == "" {
		return ""
	}
	mimeType := r.MimeType
	if mimeType == "" {
		mimeType = "image/png"
	}
	if strings.HasPrefix(r.B64JSON, "data:") {
		return r.B64JSON
	}
	return "data:" + mimeType + ";base64," + r.B64JSON
}

func (r Result) PublicURLOrDataURL() string {
	if r.URL != "" {
		return r.URL
	}
	return r.DataURL()
}

func (r Result) MarkdownImage() string {
	url := r.PublicURLOrDataURL()
	if url == "" {
		return ""
	}
	return "![generated image](" + url + ")"
}

func (r Result) ToolResultText() (string, error) {
	payload := map[string]any{
		"image_id":       r.ImageID,
		"task_id":        r.TaskID,
		"task_url":       r.TaskURL,
		"status":         r.Status,
		"url":            r.URL,
		"b64_json":       r.B64JSON,
		"mime_type":      r.MimeType,
		"revised_prompt": r.RevisedPrompt,
		"model":          r.Model,
		"prompt":         r.Prompt,
	}
	if displayURL := r.PublicURLOrDataURL(); displayURL != "" {
		payload["display_url"] = displayURL
		payload["display_markdown"] = r.MarkdownImage()
		payload["instruction"] = "The image generation succeeded. Include display_markdown exactly in the final answer so the user can see the generated image."
		data, err := json.Marshal(payload)
		if err != nil {
			return "", err
		}
		return "Image generation succeeded.\nYou must include this exact Markdown image in your final answer:\n" +
			r.MarkdownImage() + "\n\nRaw result JSON:\n" + string(data), nil
	}

	status := strings.TrimSpace(r.Status)
	if status == "" {
		status = "processing"
	}
	payload["instruction"] = "No displayable image URL is available yet. Do not say the image is visible. Tell the user the task status and task_id."
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Image generation task is %s. No displayable image URL is available yet. Raw result JSON:\n%s", status, string(data)), nil
}

type GenerateExecutor func(c *gin.Context, parentInfo *relaycommon.RelayInfo, args GenerateArgs) (Result, *types.NewAPIError)

var generateExecutor GenerateExecutor

func RegisterGenerateExecutor(executor GenerateExecutor) {
	generateExecutor = executor
}

func ExecuteGenerate(c *gin.Context, parentInfo *relaycommon.RelayInfo, args GenerateArgs) (Result, *types.NewAPIError) {
	if generateExecutor == nil {
		return Result{}, types.NewErrorWithStatusCode(
			fmt.Errorf("image generation executor is not registered"),
			types.ErrorCodeInvalidRequest,
			http.StatusServiceUnavailable,
			types.ErrOptionWithSkipRetry(),
		)
	}
	return generateExecutor(c, parentInfo, args)
}
