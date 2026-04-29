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
			"status": "completed",
			"result": {
				"images": [
					{"url": ["https://example.com/a.png"]},
					{"url": "https://example.com/b.png"}
				]
			}
		}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult returned error: %v", err)
	}
	if got.Status != string(model.TaskStatusSuccess) {
		t.Fatalf("status = %q, want %q", got.Status, model.TaskStatusSuccess)
	}
	if len(got.Urls) != 2 || got.Urls[0] != "https://example.com/a.png" || got.Urls[1] != "https://example.com/b.png" {
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
