package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

func TestApplyChannelUpstreamModelUpdates_DoesNotPublishWhenAbilitiesFail(t *testing.T) {
	setupTestDBForUpstream(t)
	setupRedisForUpstream(t)

	ch := &model.Channel{Name: "apply-fail", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	settings := ch.GetOtherSettings()
	settings.UpstreamModelUpdateLastDetectedModels = []string{"gpt-4o"}
	ch.SetOtherSettings(settings)
	if err := model.DB.Create(ch).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := model.DB.Migrator().DropTable(&model.Ability{}); err != nil {
		t.Fatalf("drop abilities table: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	redisCh := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	_, _, _, _, modelsChanged, err := applyChannelUpstreamModelUpdates(
		ch,
		[]string{"gpt-4o"},
		nil,
		nil,
	)
	if err == nil {
		t.Fatal("expected UpdateAbilities failure")
	}
	if !modelsChanged {
		t.Fatal("modelsChanged should be true")
	}

	select {
	case raw := <-redisCh:
		t.Fatalf("should not publish when UpdateAbilities fails, got: %s", raw.Payload)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestCheckAndPersistChannelUpstreamModelUpdates_DoesNotPublishWhenAbilitiesFail(t *testing.T) {
	setupTestDBForUpstream(t)
	setupRedisForUpstream(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4"},{"id":"gpt-4o"}]}`))
	}))
	defer server.Close()

	baseURL := server.URL
	ch := &model.Channel{
		Name:    "auto-apply-fail",
		Type:    constant.ChannelTypeOpenAI,
		Key:     "sk-x",
		Status:  common.ChannelStatusEnabled,
		Models:  "gpt-4",
		BaseURL: &baseURL,
	}
	settings := ch.GetOtherSettings()
	settings.UpstreamModelUpdateAutoSyncEnabled = true
	if err := model.DB.Create(ch).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := model.DB.Migrator().DropTable(&model.Ability{}); err != nil {
		t.Fatalf("drop abilities table: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	redisCh := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	modelsChanged, autoAdded, err := checkAndPersistChannelUpstreamModelUpdates(ch, &settings, true, true)
	if err == nil {
		t.Fatal("expected UpdateAbilities failure")
	}
	if !modelsChanged {
		t.Fatal("modelsChanged should be true")
	}
	if autoAdded != 1 {
		t.Fatalf("autoAdded = %d, want 1", autoAdded)
	}

	select {
	case raw := <-redisCh:
		t.Fatalf("should not publish when UpdateAbilities fails, got: %s", raw.Payload)
	case <-time.After(300 * time.Millisecond):
	}
}
