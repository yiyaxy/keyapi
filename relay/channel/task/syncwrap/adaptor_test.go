package syncwrap

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestDoResponseReturnsLocalTaskIDAndStoresRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	n := uint(2)
	adaptor := &TaskAdaptor{request: dto.ImageRequest{
		Model:  "dall-e-3",
		Prompt: "cat",
		N:      &n,
	}}
	info := &relaycommon.RelayInfo{
		OriginModelName: "dall-e-3",
		RequestURLPath:  "/v1/images/async",
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{PublicTaskID: "task_local"},
	}
	info.ChannelMeta = &relaycommon.ChannelMeta{UpstreamModelName: "mapped-image-model"}

	taskID, taskData, taskErr := adaptor.DoResponse(c, &http.Response{}, info)
	if taskErr != nil {
		t.Fatalf("DoResponse returned error: %v", taskErr)
	}
	if taskID != "task_local" {
		t.Fatalf("taskID = %q, want task_local", taskID)
	}
	if !strings.Contains(w.Body.String(), `"task_id":"task_local"`) {
		t.Fatalf("response body did not contain local task id: %s", w.Body.String())
	}

	var stored dto.ImageRequest
	if err := json.Unmarshal(taskData, &stored); err != nil {
		t.Fatalf("stored request unmarshal failed: %v", err)
	}
	if stored.Model != "mapped-image-model" || stored.Prompt != "cat" {
		t.Fatalf("unexpected stored request: %#v", stored)
	}
}
