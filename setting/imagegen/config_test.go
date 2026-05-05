package imagegen

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func withOption(t *testing.T, key, value string, set bool) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	prev, hadPrev := common.OptionMap[key]
	if set {
		common.OptionMap[key] = value
	} else {
		delete(common.OptionMap, key)
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if hadPrev {
			common.OptionMap[key] = prev
		} else {
			delete(common.OptionMap, key)
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func TestRenderSubmittedMessage_DefaultTemplate(t *testing.T) {
	withOption(t, OptionSubmittedMessageTemplate, "", false)

	got := RenderSubmittedMessage("abc123", "https://example.com/x")
	want := "你的图片生成任务已提交，任务 ID：abc123。可以前往 https://example.com/x 查看进度。生成完成后我会继续把图片发在这里。\n\n"
	if got != want {
		t.Fatalf("default template:\n got = %q\nwant = %q", got, want)
	}
}

func TestRenderSubmittedMessage_DefaultTemplate_NoURL(t *testing.T) {
	withOption(t, OptionSubmittedMessageTemplate, "", false)

	got := RenderSubmittedMessage("abc123", "")
	want := "你的图片生成任务已提交，任务 ID：abc123。可以前往查看进度。生成完成后我会继续把图片发在这里。\n\n"
	if got != want {
		t.Fatalf("default template no-url:\n got = %q\nwant = %q", got, want)
	}
}

func TestRenderSubmittedMessage_CustomTemplate(t *testing.T) {
	withOption(t, OptionSubmittedMessageTemplate, "Task {task_id} → {task_url}", true)

	got := RenderSubmittedMessage("xyz", "https://u/")
	if got != "Task xyz → https://u/" {
		t.Fatalf("custom template: got %q", got)
	}
}

func TestRenderSubmittedMessage_EmptyTemplateOptOut(t *testing.T) {
	withOption(t, OptionSubmittedMessageTemplate, "", true)

	if got := RenderSubmittedMessage("abc", "https://u/"); got != "" {
		t.Fatalf("empty template should opt out, got %q", got)
	}
}

func TestRenderSubmittedMessage_EmptyTaskID(t *testing.T) {
	if got := RenderSubmittedMessage("", "https://u/"); got != "" {
		t.Fatalf("empty task id should yield empty, got %q", got)
	}
}

func TestRenderSubmittedMessage_NoURLPlaceholderUnaffected(t *testing.T) {
	withOption(t, OptionSubmittedMessageTemplate, "submitted: {task_id}", true)

	got := RenderSubmittedMessage("zz", "")
	if got != "submitted: zz" {
		t.Fatalf("templates without {task_url}:\n got = %q", got)
	}
}

func TestReturnOnSubmitEnabled_Default(t *testing.T) {
	withOption(t, OptionReturnOnSubmit, "", false)
	if ReturnOnSubmitEnabled() {
		t.Fatal("default should be false (preserve sync-feel behavior)")
	}
}

func TestReturnOnSubmitEnabled_True(t *testing.T) {
	withOption(t, OptionReturnOnSubmit, "true", true)
	if !ReturnOnSubmitEnabled() {
		t.Fatal("expected true when option set to 'true'")
	}
}

func TestReturnOnSubmitEnabled_GarbageDefaultsFalse(t *testing.T) {
	// Defensive: a typo / migration mishap in the OptionMap shouldn't silently
	// flip the chat into fire-and-forget mode without operator intent.
	withOption(t, OptionReturnOnSubmit, "yesplease", true)
	if ReturnOnSubmitEnabled() {
		t.Fatal("invalid value must default to false")
	}
}
