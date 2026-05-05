package imagegen

import (
	"crypto/hmac"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	PublicTaskPathPrefix = "/public/images/async"
	PublicTaskLinkTTL    = 24 * time.Hour
)

var (
	ErrPublicTaskLinkExpired = errors.New("public image task link expired")
	ErrPublicTaskLinkInvalid = errors.New("public image task link invalid")
)

func PublicTaskURL(baseURL string, taskID string, expiresAt int64) string {
	return publicTaskURL(baseURL, publicTaskPath(taskID), taskID, expiresAt)
}

func PublicTaskContentURL(baseURL string, taskID string, index int, expiresAt int64) string {
	path := publicTaskPath(taskID) + "/content/" + strconv.Itoa(index)
	return publicTaskURL(baseURL, path, taskID, expiresAt)
}

func ValidatePublicTaskLink(taskID string, expiresRaw string, signature string, now time.Time) error {
	taskID = strings.TrimSpace(taskID)
	signature = strings.TrimSpace(signature)
	expiresAt, err := strconv.ParseInt(strings.TrimSpace(expiresRaw), 10, 64)
	if taskID == "" || signature == "" || err != nil {
		return ErrPublicTaskLinkInvalid
	}
	if now.Unix() > expiresAt {
		return ErrPublicTaskLinkExpired
	}
	expected := publicTaskSignature(taskID, expiresAt)
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return ErrPublicTaskLinkInvalid
	}
	return nil
}

func publicTaskURL(baseURL string, path string, taskID string, expiresAt int64) string {
	q := url.Values{}
	q.Set("expires", strconv.FormatInt(expiresAt, 10))
	q.Set("sig", publicTaskSignature(taskID, expiresAt))

	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return path + "?" + q.Encode()
	}
	return baseURL + path + "?" + q.Encode()
}

func publicTaskPath(taskID string) string {
	return PublicTaskPathPrefix + "/" + url.PathEscape(strings.TrimSpace(taskID))
}

func publicTaskSignature(taskID string, expiresAt int64) string {
	payload := "imagegen-public-task-v1\n" + strings.TrimSpace(taskID) + "\n" + strconv.FormatInt(expiresAt, 10)
	return common.GenerateHMAC(payload)
}
