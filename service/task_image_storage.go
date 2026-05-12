package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
)

const imageTaskCleanupBatchSize = 100

type ImageTaskCleanupResult struct {
	DeletedMessages int64
	DeletedTasks    int64
	DeletedObjects  int64
}

func PersistTaskImageDataToStorage(ctx context.Context, task *model.Task, data []dto.ImageData) ([]dto.ImageData, error) {
	if task == nil {
		return nil, fmt.Errorf("image task is nil")
	}
	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, fmt.Errorf("image storage client unavailable: %w", err)
	}

	persisted := make([]dto.ImageData, 0, len(data))
	for i, item := range data {
		item.Url = strings.TrimSpace(item.Url)
		item.B64Json = strings.TrimSpace(item.B64Json)
		if item.Url == "" && item.B64Json == "" {
			continue
		}
		if objectKey, ok := ticket_storage.ObjectKeyFromURL(item.Url); ok {
			item.Url = ticket_storage.ObjectURL(objectKey)
			item.B64Json = ""
			persisted = append(persisted, item)
			continue
		}

		contentType, body, err := imageDataBytes(item)
		if err != nil {
			return nil, fmt.Errorf("prepare image %d for storage: %w", i, err)
		}
		objectKey := storedTaskImageObjectKey(task.TaskID, i, contentType, body)
		logger.LogInfo(ctx, fmt.Sprintf("image task storage upload start task=%s index=%d object_key=%s size_bytes=%d", task.TaskID, i, objectKey, len(body)))
		if err := client.UploadObject(ctx, objectKey, contentType, body); err != nil {
			return nil, fmt.Errorf("upload image %d to storage: %w", i, err)
		}
		logger.LogInfo(ctx, fmt.Sprintf("image task storage upload success task=%s index=%d object_key=%s", task.TaskID, i, objectKey))

		item.Url = ticket_storage.ObjectURL(objectKey)
		item.B64Json = ""
		persisted = append(persisted, item)
	}
	return persisted, nil
}

func CleanupExpiredMobileChatData(ctx context.Context, now time.Time) (*ImageTaskCleanupResult, error) {
	if now.IsZero() {
		now = time.Now()
	}
	result := &ImageTaskCleanupResult{}

	db := model.WithTenantBypass(model.DB).Where("expires_at_ms <= ?", now.UnixMilli()).Delete(&model.MobileChatMessage{})
	if db.Error != nil {
		return result, db.Error
	}
	result.DeletedMessages = db.RowsAffected

	deletedTasks, deletedObjects, err := CleanupExpiredImageTasks(ctx, now)
	result.DeletedTasks = deletedTasks
	result.DeletedObjects = deletedObjects
	return result, err
}

func StartMobileChatRetentionCleanupLoop(interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	runMobileChatRetentionCleanup(context.Background())
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		runMobileChatRetentionCleanup(context.Background())
	}
}

func runMobileChatRetentionCleanup(ctx context.Context) {
	result, err := CleanupExpiredMobileChatData(ctx, time.Now())
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("mobile chat retention cleanup failed: %s", err.Error()))
		return
	}
	if result.DeletedMessages > 0 || result.DeletedTasks > 0 || result.DeletedObjects > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("mobile chat retention cleanup: messages=%d image_tasks=%d objects=%d", result.DeletedMessages, result.DeletedTasks, result.DeletedObjects))
	}
}

func CleanupExpiredImageTasks(ctx context.Context, now time.Time) (int64, int64, error) {
	if now.IsZero() {
		now = time.Now()
	}
	cutoff := now.Add(-time.Duration(model.MobileChatMessageTTLSeconds) * time.Second).Unix()
	var totalTasks int64
	var totalObjects int64

	for {
		tasks, err := model.GetExpiredImageTasks(cutoff, imageTaskCleanupBatchSize)
		if err != nil {
			return totalTasks, totalObjects, err
		}
		if len(tasks) == 0 {
			return totalTasks, totalObjects, nil
		}

		objectKeys := make([]string, 0)
		taskIDs := make([]int64, 0, len(tasks))
		for _, task := range tasks {
			if task == nil {
				continue
			}
			taskIDs = append(taskIDs, task.ID)
			objectKeys = append(objectKeys, storedObjectKeysFromTask(task)...)
		}

		if len(objectKeys) > 0 {
			client, err := ticket_storage.GetClient()
			if err != nil {
				return totalTasks, totalObjects, fmt.Errorf("image storage client unavailable: %w", err)
			}
			for _, objectKey := range uniqueStrings(objectKeys) {
				if err := client.DeleteObject(ctx, objectKey); err != nil {
					return totalTasks, totalObjects, fmt.Errorf("delete image object %s: %w", objectKey, err)
				}
				totalObjects++
			}
		}

		deleted, err := model.DeleteTasksByIDs(taskIDs)
		if err != nil {
			return totalTasks, totalObjects, err
		}
		totalTasks += deleted
		if len(tasks) < imageTaskCleanupBatchSize {
			return totalTasks, totalObjects, nil
		}
	}
}

func storedObjectKeysFromTask(task *model.Task) []string {
	if task == nil {
		return nil
	}
	var data []dto.ImageData
	if len(task.PrivateData.ImageData) > 0 {
		_ = common.Unmarshal(task.PrivateData.ImageData, &data)
	}
	keys := make([]string, 0, len(data)+1)
	for _, item := range data {
		if key, ok := storedAsyncImageObjectKey(item.Url); ok {
			keys = append(keys, key)
		}
	}
	if key, ok := storedAsyncImageObjectKey(task.PrivateData.ResultURL); ok {
		keys = append(keys, key)
	}
	return keys
}

func storedAsyncImageObjectKey(rawURL string) (string, bool) {
	objectKey, ok := ticket_storage.ObjectKeyFromURL(rawURL)
	if !ok {
		return "", false
	}
	objectKey = strings.TrimPrefix(strings.TrimSpace(objectKey), "/")
	return objectKey, strings.HasPrefix(objectKey, "images/async/")
}

func imageDataBytes(item dto.ImageData) (string, []byte, error) {
	if item.Url != "" {
		contentType, b64Data, err := GetImageFromUrl(item.Url)
		if err != nil {
			return "", nil, err
		}
		body, err := base64.StdEncoding.DecodeString(b64Data)
		if err != nil {
			return "", nil, fmt.Errorf("decode downloaded image: %w", err)
		}
		return normalizeImageContentType(contentType), body, nil
	}
	if item.B64Json != "" {
		contentType, cleanBase64, err := DecodeBase64FileData(item.B64Json)
		if err != nil {
			return "", nil, err
		}
		body, err := base64.StdEncoding.DecodeString(cleanBase64)
		if err != nil {
			return "", nil, fmt.Errorf("decode base64 image: %w", err)
		}
		return normalizeImageContentType(contentType), body, nil
	}
	return "", nil, fmt.Errorf("image has neither url nor b64_json")
}

func normalizeImageContentType(contentType string) string {
	contentType = strings.TrimSpace(contentType)
	if contentType == "" || contentType == "application/octet-stream" {
		return "image/png"
	}
	if mediaType, _, err := mime.ParseMediaType(contentType); err == nil && mediaType != "" {
		contentType = mediaType
	}
	if !strings.HasPrefix(contentType, "image/") {
		return "image/png"
	}
	return contentType
}

func storedTaskImageObjectKey(taskID string, index int, contentType string, body []byte) string {
	sum := sha256.Sum256(body)
	ext := imageExtension(contentType)
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		taskID = "unknown"
	}
	return fmt.Sprintf("images/async/%s/%d-%s%s", taskID, index, hex.EncodeToString(sum[:])[:16], ext)
}

func imageExtension(contentType string) string {
	contentType = normalizeImageContentType(contentType)
	exts, err := mime.ExtensionsByType(contentType)
	if err == nil && len(exts) > 0 {
		if exts[0] == ".jpe" {
			return ".jpg"
		}
		return exts[0]
	}
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
