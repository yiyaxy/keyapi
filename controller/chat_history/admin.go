// Package chat_history hosts the admin-facing HTTP handlers for the
// "view conversation history" feature. Recording is implemented in
// service/chat_history; this package only deals with reading captured
// envelopes back out for admin review.
package chat_history

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"

	"github.com/gin-gonic/gin"
)

// listMaxPageSize bounds how many rows one list call returns. Captured
// envelopes can be tens to hundreds of KB each at detail-fetch time, so the
// list view stays metadata-only and uses paging rather than a streaming
// download.
const listMaxPageSize = 100

// listResponse is the JSON shape returned by the list endpoint. We expose
// only metadata fields here — the heavy body lives in OSS and is fetched
// on demand by detail.
type listResponse struct {
	Items []listItem `json:"items"`
	Total int64      `json:"total"`
	Page  int        `json:"page"`
	Size  int        `json:"size"`
}

type listItem struct {
	Id               int    `json:"id"`
	RequestId        string `json:"request_id"`
	UserId           int    `json:"user_id"`
	Username         string `json:"username"`
	TenantId         int    `json:"tenant_id"`
	ModelName        string `json:"model_name"`
	CreatedAt        int64  `json:"created_at"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	UseTimeMs        int    `json:"use_time_ms"`
	IsStream         bool   `json:"is_stream"`
	MessageSizeBytes int64  `json:"message_size_bytes"`
}

// AdminList lists captured chat-history records, scoped to the caller's
// permissions:
//   - Platform admin (role >= RoleAdminUser): can see all tenants; if the
//     query supplies tenant_id, only that tenant.
//   - Tenant admin: implicitly scoped to their own tenant; tenant_id query
//     param is ignored if it disagrees.
//
// Filters: user_id, model, from / to (unix seconds). Paging via page + size.
func AdminList(c *gin.Context) {
	page := atoiOr(c.Query("page"), 1)
	size := clampInt(atoiOr(c.Query("size"), 20), 1, listMaxPageSize)
	userID := atoiOr(c.Query("user_id"), 0)
	modelName := strings.TrimSpace(c.Query("model"))
	from := atoi64Or(c.Query("from"), 0)
	to := atoi64Or(c.Query("to"), 0)

	tenantID, err := resolveTenantScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	q := model.LOG_DB.Model(&model.Log{}).Where("message_object_key <> ?", "")
	if tenantID > 0 {
		q = q.Where("tenant_id = ?", tenantID)
	}
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	}
	if modelName != "" {
		q = q.Where("model_name = ?", modelName)
	}
	if from > 0 {
		q = q.Where("created_at >= ?", from)
	}
	if to > 0 {
		q = q.Where("created_at <= ?", to)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var rows []model.Log
	if err := q.Order("created_at DESC, id DESC").
		Limit(size).
		Offset((page - 1) * size).
		Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]listItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, listItem{
			Id:               r.Id,
			RequestId:        r.RequestId,
			UserId:           r.UserId,
			Username:         r.Username,
			TenantId:         r.TenantId,
			ModelName:        r.ModelName,
			CreatedAt:        r.CreatedAt,
			PromptTokens:     r.PromptTokens,
			CompletionTokens: r.CompletionTokens,
			UseTimeMs:        r.UseTime,
			IsStream:         r.IsStream,
			MessageSizeBytes: r.MessageSizeBytes,
		})
	}

	common.ApiSuccess(c, listResponse{
		Items: items,
		Total: total,
		Page:  page,
		Size:  size,
	})
}

// AdminDetail returns the parsed envelope for one captured request.
//
// We intentionally proxy + decompress server-side rather than handing back
// a presigned OSS URL because:
//   - the envelope is gzipped JSON; browsers don't transparently un-gzip
//     a presigned response unless we set headers we don't control on OSS;
//   - we want to enforce the same tenant scope on the detail fetch, which
//     a direct presigned URL would bypass.
func AdminDetail(c *gin.Context) {
	requestID := strings.TrimSpace(c.Param("request_id"))
	if requestID == "" {
		common.ApiError(c, errors.New("request_id is required"))
		return
	}

	tenantID, err := resolveTenantScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	q := model.LOG_DB.Model(&model.Log{}).
		Where("request_id = ? AND message_object_key <> ?", requestID, "")
	if tenantID > 0 {
		q = q.Where("tenant_id = ?", tenantID)
	}

	var row model.Log
	if err := q.First(&row).Error; err != nil {
		// Treat not-found as 404 rather than 500 so the UI can handle it.
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "record not found"})
		return
	}

	client, err := ticket_storage.GetClient()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Presign for ~5min so a slow link still works, but the URL itself
	// never leaves this server's process — we fetch and decompress here.
	presigned, _, err := client.PresignGet(row.MessageObjectKey, 5*time.Minute)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	envelope, err := fetchAndUngzip(presigned)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json", envelope)
}

// resolveTenantScope returns the tenant_id we should constrain queries to.
//   - Platform admin: returns the tenant_id from the query (or 0 = no scope).
//   - Tenant admin: returns their tenant id, regardless of any query param.
//
// Caller has already passed TenantAdminAuth so we know the user is at least
// a tenant admin.
func resolveTenantScope(c *gin.Context) (int, error) {
	platformRole := c.GetInt("platform_role")
	if platformRole >= common.RoleAdminUser {
		// Platform admin (super) — query param wins, 0 = all tenants.
		if explicit := atoiOr(c.Query("tenant_id"), 0); explicit > 0 {
			return explicit, nil
		}
		return 0, nil
	}
	// Tenant admin — pin to their tenant.
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		return 0, errors.New("tenant context unresolved")
	}
	return tid, nil
}

func fetchAndUngzip(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, errors.New("storage GET status " + strconv.Itoa(resp.StatusCode) + ": " + strings.TrimSpace(string(body)))
	}
	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	// Cap at the recorder's MaxResponseBufferBytes + reasonable request body
	// allowance; if anything larger ever lands in storage it's a bug we want
	// to know about, not silently truncate.
	const maxRead = 16 * 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(gz, maxRead+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxRead {
		return nil, errors.New("captured envelope exceeds 16MiB read cap")
	}
	// Validate JSON shape so the UI can rely on it; if invalid, surface as
	// an error rather than passing back garbage.
	if !json.Valid(body) {
		return nil, errors.New("captured envelope is not valid JSON")
	}
	return body, nil
}

func atoiOr(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}

func atoi64Or(s string, def int64) int64 {
	if s == "" {
		return def
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return def
	}
	return v
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
