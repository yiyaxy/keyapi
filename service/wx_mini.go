package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// This file implements helpers for WeChat mini-program scan-to-login:
//   - access_token cache (2h WeChat TTL, refreshed ~5min before expiry)
//   - wxacode.getUnlimited (generates a "小程序码" PNG with a scene)
//
// Credentials are read from the tenant's payment config row (single source
// of truth) — payment and mini-login share the same AppId / AppSecret pair.
//
// Both Redis-backed (when REDIS_CONN_STRING is set) and in-memory
// fallbacks are provided so the feature works in single-node dev too.

const (
	accessTokenCacheKeyPrefix = "wxmini:access_token:"
	sessionKeyCacheKeyPrefix  = "wxmini:session_key:"
	accessTokenSafetyMargin   = 300 // seconds subtracted from expires_in
	wxMiniSessionKeyTTL       = 7200 * time.Second
)

type wxAccessTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	ErrCode     int    `json:"errcode,omitempty"`
	ErrMsg      string `json:"errmsg,omitempty"`
}

// in-memory cache (used when Redis is off). Keyed by tenantId so each
// tenant's WeChat token is isolated.
type memAccessToken struct {
	value  string
	expire time.Time
}

type memSessionKey struct {
	value  string
	expire time.Time
}

var (
	memAccessTokens sync.Map // map[int]memAccessToken
	memSessionKeys  sync.Map // map[string]memSessionKey
)

// fetchTokenMu serializes concurrent upstream fetches per-tenant so we don't
// blow through WeChat's 2000/day token quota on a cold cache. Stored per-
// tenant so a tenant with a hot cache doesn't wait on another's miss.
var fetchTokenMus sync.Map // map[int]*sync.Mutex

func fetchTokenLock(tenantId int) *sync.Mutex {
	if m, ok := fetchTokenMus.Load(tenantId); ok {
		return m.(*sync.Mutex)
	}
	actual, _ := fetchTokenMus.LoadOrStore(tenantId, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// WxMiniCredentials is the plaintext AppId/AppSecret pair used by the
// mini-program OAuth + access_token flow. Loaded from the tenant's payment
// config row; same fields the payment JSAPI flow uses.
type WxMiniCredentials struct {
	AppId     string
	AppSecret string
	// MiniLoginEnabled is the tenant-level feature flag (tenant_payment_configs.mini_login_enabled).
	MiniLoginEnabled bool
}

// LoadWxMiniCredentials reads AppId+AppSecret from the tenant's payment
// config. Returns a clear error when the tenant hasn't configured the
// mini-program yet — the caller surfaces that to the client so the admin
// knows where to go.
func LoadWxMiniCredentials(tenantId int) (*WxMiniCredentials, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	cfg, err := model.GetTenantPaymentConfig(tenantId, "wechat")
	if err != nil {
		return nil, fmt.Errorf("当前租户尚未配置微信支付/小程序：%w", err)
	}
	if cfg.AppId == "" {
		return nil, errors.New("当前租户未配置小程序 AppId")
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, fmt.Errorf("解密 AppSecret 失败: %w", err)
	}
	if plain.AppSecret == "" {
		return nil, errors.New("当前租户未配置 AppSecret")
	}
	return &WxMiniCredentials{
		AppId:            cfg.AppId,
		AppSecret:        plain.AppSecret,
		MiniLoginEnabled: cfg.MiniLoginEnabled,
	}, nil
}

// IsWxMiniLoginEnabled is the cheap probe the /api/status endpoint uses —
// only looks at the enable flag, doesn't decrypt anything.
func IsWxMiniLoginEnabled(tenantId int) bool {
	if tenantId <= 0 {
		return false
	}
	cfg, err := model.GetTenantPaymentConfig(tenantId, "wechat")
	if err != nil {
		return false
	}
	return cfg.MiniLoginEnabled && cfg.AppId != ""
}

// GetWxMiniAccessToken returns a valid WeChat mini-program access_token for
// the given tenant, fetching + caching a fresh one if needed.
func GetWxMiniAccessToken(tenantId int) (string, error) {
	creds, err := LoadWxMiniCredentials(tenantId)
	if err != nil {
		return "", err
	}

	cacheKey := accessTokenCacheKeyPrefix + strconv.Itoa(tenantId)

	if tok := loadAccessTokenFromCache(tenantId, cacheKey); tok != "" {
		return tok, nil
	}

	lock := fetchTokenLock(tenantId)
	lock.Lock()
	defer lock.Unlock()

	// re-check after acquiring lock (another goroutine may have filled it)
	if tok := loadAccessTokenFromCache(tenantId, cacheKey); tok != "" {
		return tok, nil
	}

	token, ttl, err := fetchAccessTokenUpstream(creds)
	if err != nil {
		return "", err
	}
	storeAccessTokenToCache(tenantId, cacheKey, token, ttl)
	return token, nil
}

func loadAccessTokenFromCache(tenantId int, cacheKey string) string {
	if common.RedisEnabled {
		val, err := common.RedisGet(cacheKey)
		if err == nil && val != "" {
			return val
		}
		return ""
	}
	if v, ok := memAccessTokens.Load(tenantId); ok {
		t := v.(memAccessToken)
		if t.value != "" && time.Now().Before(t.expire) {
			return t.value
		}
		memAccessTokens.Delete(tenantId)
	}
	return ""
}

func storeAccessTokenToCache(tenantId int, cacheKey string, token string, ttl time.Duration) {
	if common.RedisEnabled {
		if err := common.RedisSet(cacheKey, token, ttl); err != nil {
			common.SysError("cache wx_mini access_token to redis failed: " + err.Error())
		}
		return
	}
	memAccessTokens.Store(tenantId, memAccessToken{
		value:  token,
		expire: time.Now().Add(ttl),
	})
}

func fetchAccessTokenUpstream(creds *WxMiniCredentials) (string, time.Duration, error) {
	endpoint := fmt.Sprintf(
		"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		creds.AppId, creds.AppSecret,
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

// GetWxaCodeUnlimited calls wxacode.getUnlimited for the given tenant and
// returns the PNG bytes. Caller is responsible for base64-encoding or
// streaming the result.
//
// scene: max 32 chars, only [0-9a-zA-Z!#$&'()*+,/:;=?@-._~]
// page:  e.g. "pages/qr-confirm/index"; must exist in mini-program
// envVersion: "release" | "trial" | "develop"
func GetWxaCodeUnlimited(tenantId int, scene, page, envVersion string) ([]byte, error) {
	if scene == "" || len(scene) > 32 {
		return nil, errors.New("scene 非法：长度必须在 1..32")
	}
	if envVersion == "" {
		envVersion = "release"
	}

	token, err := GetWxMiniAccessToken(tenantId)
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

	// WeChat returns JSON on error, binary PNG on success. Content-Type is
	// image/jpeg or image/png on success; application/json on error.
	ct := resp.Header.Get("Content-Type")
	if len(ct) >= 16 && ct[:16] == "application/json" {
		var apiErr wxAccessTokenResponse
		if err := common.Unmarshal(data, &apiErr); err == nil && apiErr.ErrCode != 0 {
			// access_token may have been revoked server-side; clear cache so
			// the next call re-fetches.
			if apiErr.ErrCode == 40001 || apiErr.ErrCode == 42001 || apiErr.ErrCode == 41001 {
				invalidateAccessTokenCache(tenantId)
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

func invalidateAccessTokenCache(tenantId int) {
	cacheKey := accessTokenCacheKeyPrefix + strconv.Itoa(tenantId)
	if common.RedisEnabled {
		_ = common.RedisDel(cacheKey)
		return
	}
	memAccessTokens.Delete(tenantId)
}

type WxMiniSession struct {
	OpenId     string
	SessionKey string
}

func wxMiniSessionCacheKey(tenantId int, openid string) string {
	return sessionKeyCacheKeyPrefix + strconv.Itoa(tenantId) + ":" + openid
}

func StoreWxMiniSessionKey(tenantId int, openid string, sessionKey string) {
	if tenantId <= 0 || openid == "" || sessionKey == "" {
		return
	}
	key := wxMiniSessionCacheKey(tenantId, openid)
	if common.RedisEnabled {
		if err := common.RedisSet(key, sessionKey, wxMiniSessionKeyTTL); err != nil {
			common.SysError("cache wx_mini session_key to redis failed: " + err.Error())
		}
		return
	}
	memSessionKeys.Store(key, memSessionKey{
		value:  sessionKey,
		expire: time.Now().Add(wxMiniSessionKeyTTL),
	})
}

func GetWxMiniSessionKey(tenantId int, openid string) (string, bool) {
	if tenantId <= 0 || openid == "" {
		return "", false
	}
	key := wxMiniSessionCacheKey(tenantId, openid)
	if common.RedisEnabled {
		val, err := common.RedisGet(key)
		return val, err == nil && val != ""
	}
	if v, ok := memSessionKeys.Load(key); ok {
		t := v.(memSessionKey)
		if t.value != "" && time.Now().Before(t.expire) {
			return t.value, true
		}
		memSessionKeys.Delete(key)
	}
	return "", false
}

// ExchangeWxMiniSession calls jscode2session against the tenant's credentials,
// returns openid + session_key, and caches session_key for xpay signing.
func ExchangeWxMiniSession(tenantId int, code string) (*WxMiniSession, error) {
	if code == "" {
		return nil, errors.New("微信登录凭证为空")
	}
	creds, err := LoadWxMiniCredentials(tenantId)
	if err != nil {
		return nil, err
	}

	endpoint := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		creds.AppId, creds.AppSecret, code,
	)

	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		return nil, fmt.Errorf("调用微信接口失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取微信响应失败: %w", err)
	}

	var parsed struct {
		OpenId     string `json:"openid"`
		SessionKey string `json:"session_key"`
		ErrCode    int    `json:"errcode,omitempty"`
		ErrMsg     string `json:"errmsg,omitempty"`
	}
	if err := common.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析微信响应失败: %w", err)
	}

	if parsed.ErrCode != 0 {
		return nil, fmt.Errorf("微信登录失败: %s (errcode=%d)", parsed.ErrMsg, parsed.ErrCode)
	}
	if parsed.OpenId == "" {
		return nil, errors.New("微信未返回 openid")
	}
	if parsed.SessionKey != "" {
		StoreWxMiniSessionKey(tenantId, parsed.OpenId, parsed.SessionKey)
	}
	return &WxMiniSession{OpenId: parsed.OpenId, SessionKey: parsed.SessionKey}, nil
}

// ExchangeWxMiniCode is kept for callers that only need openid.
func ExchangeWxMiniCode(tenantId int, code string) (string, error) {
	session, err := ExchangeWxMiniSession(tenantId, code)
	if err != nil {
		return "", err
	}
	return session.OpenId, nil
}
