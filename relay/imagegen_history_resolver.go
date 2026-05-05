package relay

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"
)

// resolvedURLRefreshMargin is how much TTL we leave on the underlying presigned
// URL before refreshing. Provider prompt caches (OpenAI/Claude) match on the
// exact prefix bytes — including the URL's Signature & Expires query string —
// so re-presigning on every call gives us a different URL each turn and
// guarantees a cache miss. We keep the URL stable for nearly its whole lifetime
// instead, refreshing only when expiry is close enough that a slow upstream
// fetch could 403.
const resolvedURLRefreshMargin = 30 * time.Minute

type cachedDirectURL struct {
	url       string
	expiresAt time.Time
}

var (
	resolvedURLCacheMu sync.RWMutex
	resolvedURLCache   = map[string]cachedDirectURL{}
)

func directURLCacheKey(taskID string, idx int) string {
	return fmt.Sprintf("%s/%d", taskID, idx)
}

func loadCachedDirectURL(taskID string, idx int) (string, bool) {
	resolvedURLCacheMu.RLock()
	entry, ok := resolvedURLCache[directURLCacheKey(taskID, idx)]
	resolvedURLCacheMu.RUnlock()
	if !ok {
		return "", false
	}
	if time.Until(entry.expiresAt) <= resolvedURLRefreshMargin {
		return "", false
	}
	return entry.url, true
}

func storeCachedDirectURL(taskID string, idx int, u string) {
	resolvedURLCacheMu.Lock()
	defer resolvedURLCacheMu.Unlock()
	resolvedURLCache[directURLCacheKey(taskID, idx)] = cachedDirectURL{
		url:       u,
		expiresAt: time.Now().Add(relayimagegen.PublicTaskLinkTTL),
	}
}

// resetResolvedURLCache is exposed for tests; production code should not call it.
func resetResolvedURLCache() {
	resolvedURLCacheMu.Lock()
	defer resolvedURLCacheMu.Unlock()
	resolvedURLCache = map[string]cachedDirectURL{}
}

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

	// Reuse the previously-presigned URL while it still has comfortable TTL.
	// This is what makes the rewritten request prefix byte-identical across
	// turns, which is what the provider's prompt cache needs to hit.
	if cached, hit := loadCachedDirectURL(taskID, idx); hit {
		return cached
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
	storeCachedDirectURL(taskID, idx, direct)
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
