package apimart

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestParseTaskResultCompletedImages(t *testing.T) {
	adaptor := &TaskAdaptor{}
	got, err := adaptor.ParseTaskResult([]byte(`{
		"code": 200,
		"data": {
			"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
			"status": "completed",
			"progress": 100,
			"result": {
				"images": [
					{
						"url": [
							"https://upload.apimart.ai/f/image/9998236911693428-e8d7441f-f7b4-4130-97ad-9ef8a0dde2ce-image_task_01KA0413RT2GGNZJ9GWQ4PXF2F_0.png"
						],
						"expires_at": 1763174708
					},
					{"url": "https://example.com/b.png", "expires_at": "1770000001"}
				]
			},
			"created": 1763088289,
			"completed": 1763088308,
			"estimated_time": 60,
			"actual_time": 19
		}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult returned error: %v", err)
	}
	if got.Status != string(model.TaskStatusSuccess) {
		t.Fatalf("status = %q, want %q", got.Status, model.TaskStatusSuccess)
	}
	if len(got.Urls) != 2 || got.Urls[0] != "https://upload.apimart.ai/f/image/9998236911693428-e8d7441f-f7b4-4130-97ad-9ef8a0dde2ce-image_task_01KA0413RT2GGNZJ9GWQ4PXF2F_0.png" || got.Urls[1] != "https://example.com/b.png" {
		t.Fatalf("unexpected urls: %#v", got.Urls)
	}
}

func TestParseTaskResultFailed(t *testing.T) {
	adaptor := &TaskAdaptor{}
	got, err := adaptor.ParseTaskResult([]byte(`{
		"code": 200,
		"message": "outer",
		"data": {"status": "failed", "error": "bad prompt"}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult returned error: %v", err)
	}
	if got.Status != string(model.TaskStatusFailure) {
		t.Fatalf("status = %q, want %q", got.Status, model.TaskStatusFailure)
	}
	if got.Reason != "bad prompt" {
		t.Fatalf("reason = %q, want bad prompt", got.Reason)
	}
}
