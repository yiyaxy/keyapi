package relay

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"
)

func init() {
	relayimagegen.RegisterURLResolver(resolveHistoryImageURL)
}

// resolveHistoryImageURL upgrades a Markdown image URL coming out of a prior
// assistant turn into the most-direct fetchable URL available right now.
//
// Concretely: when the URL is one of our public proxy endpoints
// (`.../public/images/async/{task_id}/content/{idx}`), look up the task,
// pull out the internal `storage://...` reference, and presign a fresh OSS
// direct URL. This avoids the OpenAI vision fetcher having to hit our server
// just to be 307-redirected, and refreshes the presign TTL.
//
// Any failure returns the original URL untouched — this resolver is a
// best-effort optimization, never a correctness gate.
func resolveHistoryImageURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return rawURL
	}

	taskID, idx, ok := parsePublicTaskContentURL(rawURL)
	if !ok {
		return rawURL
	}

	task, exists, err := model.GetByOnlyTaskId(taskID)
	if err != nil || !exists || task == nil {
		return rawURL
	}

	storageURL, ok := storageURLFromTask(task, idx)
	if !ok {
		return rawURL
	}

	direct, ok, err := presignStoredImageURL(storageURL)
	if err != nil || !ok || direct == "" {
		return rawURL
	}
	return direct
}

// parsePublicTaskContentURL recognizes the `/public/images/async/{task_id}/content/{idx}`
// URL shape and extracts (task_id, idx). It tolerates any host/scheme — only
// the path layout matters — and ignores query string (signature/expiry) since
// we are about to mint a fresh direct URL from scratch.
func parsePublicTaskContentURL(rawURL string) (string, int, bool) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", 0, false
	}
	segs := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	// Expected: ["public", "images", "async", "{task_id}", "content", "{idx}"]
	if len(segs) < 6 {
		return "", 0, false
	}
	tail := segs[len(segs)-6:]
	if tail[0] != "public" || tail[1] != "images" || tail[2] != "async" || tail[4] != "content" {
		return "", 0, false
	}
	taskID := strings.TrimSpace(tail[3])
	if taskID == "" {
		return "", 0, false
	}
	idx, err := strconv.Atoi(tail[5])
	if err != nil || idx < 0 {
		return "", 0, false
	}
	return taskID, idx, true
}

// storageURLFromTask digs the internal `storage://...` URL for the given image
// index out of a task's persisted ImageData. Returns ("", false) when the task
// has no usable storage-backed image at that index.
func storageURLFromTask(task *model.Task, idx int) (string, bool) {
	if task == nil || idx < 0 {
		return "", false
	}
	var images []dto.ImageData
	if len(task.PrivateData.ImageData) == 0 {
		return "", false
	}
	if err := common.Unmarshal(task.PrivateData.ImageData, &images); err != nil {
		return "", false
	}
	if idx >= len(images) {
		return "", false
	}
	u := strings.TrimSpace(images[idx].Url)
	if u == "" {
		return "", false
	}
	return u, true
}
