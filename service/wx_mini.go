package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// This file implements helpers for WeChat mini-program scan-to-login:
//   - access_token cache (2h WeChat TTL, refreshed ~10min before expiry)
//   - wxacode.getUnlimited (generates a "小程序码" PNG with a scene)
//
// Both Redis-backed (when REDIS_CONN_STRING is set) and in-memory
// fallbacks are provided so the feature works in single-node dev too.

const (
	accessTokenCacheKey    = "wxmini:access_token"
	accessTokenSafetyMargin = 300 // seconds subtracted from expires_in
)

type wxAccessTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	ErrCode     int    `json:"errcode,omitempty"`
	ErrMsg      string `json:"errmsg,omitempty"`
}

// in-memory cache (used when Redis is off)
var (
	memAccessTokenMu     sync.Mutex
	memAccessTokenValue  string
	memAccessTokenExpire time.Time
)

// fetchTokenMu serializes concurrent upstream fetches so we don't blow through
// WeChat's 2000/day token quota on a cold cache.
var fetchTokenMu sync.Mutex

// GetWxMiniAccessToken returns a valid WeChat mini-program access_token,
// fetching + caching a fresh one if needed.
func GetWxMiniAccessToken() (string, error) {
	if common.WxMiniAppId == "" || common.WxMiniAppSecret == "" {
		return "", errors.New("管理员尚未配置小程序 AppId/AppSecret")
	}

	if tok := loadAccessTokenFromCache(); tok != "" {
		return tok, nil
	}

	fetchTokenMu.Lock()
	defer fetchTokenMu.Unlock()

	// re-check after acquiring lock (another goroutine may have filled it)
	if tok := loadAccessTokenFromCache(); tok != "" {
		return tok, nil
	}

	token, ttl, err := fetchAccessTokenUpstream()
	if err != nil {
		return "", err
	}
	storeAccessTokenToCache(token, ttl)
	return token, nil
}

func loadAccessTokenFromCache() string {
	if common.RedisEnabled {
		val, err := common.RedisGet(accessTokenCacheKey)
		if err == nil && val != "" {
			return val
		}
		return ""
	}
	memAccessTokenMu.Lock()
	defer memAccessTokenMu.Unlock()
	if memAccessTokenValue != "" && time.Now().Before(memAccessTokenExpire) {
		return memAccessTokenValue
	}
	return ""
}

func storeAccessTokenToCache(token string, ttl time.Duration) {
	if common.RedisEnabled {
		if err := common.RedisSet(accessTokenCacheKey, token, ttl); err != nil {
			common.SysError("cache wx_mini access_token to redis failed: " + err.Error())
		}
		return
	}
	memAccessTokenMu.Lock()
	defer memAccessTokenMu.Unlock()
	memAccessTokenValue = token
	memAccessTokenExpire = time.Now().Add(ttl)
}

func fetchAccessTokenUpstream() (string, time.Duration, error) {
	endpoint := fmt.Sprintf(
		"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		common.WxMiniAppId, common.WxMiniAppSecret,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", 0, err
	}
	client := http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("调用微信获取 access_token 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, err
	}

	var parsed wxAccessTokenResponse
	if err := common.Unmarshal(body, &parsed); err != nil {
		return "", 0, fmt.Errorf("解析微信 access_token 响应失败: %w", err)
	}
	if parsed.ErrCode != 0 {
		return "", 0, fmt.Errorf("微信返回错误: %s (errcode=%d)", parsed.ErrMsg, parsed.ErrCode)
	}
	if parsed.AccessToken == "" || parsed.ExpiresIn <= 0 {
		return "", 0, errors.New("微信返回的 access_token 为空")
	}

	ttlSec := parsed.ExpiresIn - accessTokenSafetyMargin
	if ttlSec < 60 {
		ttlSec = 60
	}
	return parsed.AccessToken, time.Duration(ttlSec) * time.Second, nil
}

// GetWxaCodeUnlimited calls wxacode.getUnlimited and returns the PNG bytes.
// Caller is responsible for base64-encoding or streaming the result.
//
// scene: max 32 chars, only [0-9a-zA-Z!#$&'()*+,/:;=?@-._~]
// page:  e.g. "pages/qr-confirm/index"; must exist in mini-program
// envVersion: "release" | "trial" | "develop"
func GetWxaCodeUnlimited(scene, page, envVersion string) ([]byte, error) {
	if scene == "" || len(scene) > 32 {
		return nil, errors.New("scene 非法：长度必须在 1..32")
	}
	if envVersion == "" {
		envVersion = "release"
	}

	token, err := GetWxMiniAccessToken()
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"scene":       scene,
		"page":        page,
		"env_version": envVersion,
		"check_path":  false,
		"width":       430,
	}
	bodyBytes, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}

	endpoint := "https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=" + token
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用 getwxacodeunlimit 失败: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// WeChat returns JSON on error, binary PNG on success.
	// Content-Type is image/jpeg or image/png on success;
	// application/json on error. We check Content-Type first.
	ct := resp.Header.Get("Content-Type")
	if len(ct) >= 16 && ct[:16] == "application/json" {
		var apiErr wxAccessTokenResponse
		if err := common.Unmarshal(data, &apiErr); err == nil && apiErr.ErrCode != 0 {
			// access_token may have been revoked server-side; clear cache so
			// the next call re-fetches.
			if apiErr.ErrCode == 40001 || apiErr.ErrCode == 42001 || apiErr.ErrCode == 41001 {
				invalidateAccessTokenCache()
			}
			return nil, fmt.Errorf("微信生成小程序码失败: %s (errcode=%d)", apiErr.ErrMsg, apiErr.ErrCode)
		}
		return nil, fmt.Errorf("微信返回未知错误: %s", string(data))
	}

	if len(data) == 0 {
		return nil, errors.New("微信返回空图像")
	}
	return data, nil
}

func invalidateAccessTokenCache() {
	if common.RedisEnabled {
		_ = common.RedisDel(accessTokenCacheKey)
		return
	}
	memAccessTokenMu.Lock()
	defer memAccessTokenMu.Unlock()
	memAccessTokenValue = ""
	memAccessTokenExpire = time.Time{}
}
