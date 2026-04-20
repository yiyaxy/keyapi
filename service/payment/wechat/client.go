// Package wechat implements the WeChat Pay v3 Provider.
//
// Credentials are loaded per-tenant from tenant_payment_configs and cached in
// memory as wechatpay-go core.Client instances. The clientCache key is
// tenantId; invalidation must be triggered whenever config is updated or
// deleted (controller layer calls InvalidateCache).
package wechat

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// cachedClient wraps a wechatpay-go core.Client plus the config snapshot
// used to build it, so we can detect staleness by UpdatedAt.
type cachedClient struct {
	tenantId  int
	updatedAt int64
	client    *core.Client
	mchid     string
	appid     string
}

type clientCache struct {
	mu      sync.RWMutex
	entries map[int]*cachedClient
}

func newClientCache() *clientCache {
	return &clientCache{entries: map[int]*cachedClient{}}
}

func (c *clientCache) lookup(tid int) (*cachedClient, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[tid]
	return e, ok
}

func (c *clientCache) store(tid int, e *cachedClient) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[tid] = e
}

// Invalidate drops the cached entry for a tenant.
// Call after Upsert / Delete of the config, or on credential test failure.
func (c *clientCache) Invalidate(tid int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, tid)
}

// Global singleton. S1 exposes Get via the package for reuse across handlers.
var cache = newClientCache()

// InvalidateCache removes a tenant's cached client. Exported for controller
// layer use after config mutation.
func InvalidateCache(tid int) {
	cache.Invalidate(tid)
}

// buildClient loads the tenant config and constructs a fresh core.Client.
// Returns an error (not panics) on credential corruption so the caller can
// surface a clear failure to the user and skip further calls.
//
// Uses model.GetTenantPaymentConfig which internally applies WithTenantBypass
// + explicit WHERE tenant_id=? (see §4 of the spec's guardrail rules).
func buildClient(ctx context.Context, tid int) (*cachedClient, error) {
	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if err != nil {
		return nil, fmt.Errorf("load tenant %d wechat config: %w", tid, err)
	}
	if !cfg.Enabled || cfg.PlatformLocked {
		return nil, errors.New("tenant wechat payment not enabled")
	}
	if cfg.Mchid == "" || cfg.AppId == "" || cfg.SerialNo == "" {
		return nil, errors.New("incomplete wechat credentials")
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, fmt.Errorf("decrypt credentials: %w", err)
	}
	if plain.PrivateKey == "" || plain.Apiv3Key == "" {
		return nil, errors.New("missing private key or apiv3 key")
	}
	// utils.LoadPrivateKey returns (*rsa.PrivateKey, error) directly — no cast needed.
	privKey, err := utils.LoadPrivateKey(plain.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key PEM: %w", err)
	}
	cli, err := core.NewClient(ctx,
		option.WithWechatPayAutoAuthCipher(
			cfg.Mchid, cfg.SerialNo, privKey, plain.Apiv3Key,
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build wechatpay client: %w", err)
	}
	return &cachedClient{
		tenantId:  tid,
		updatedAt: cfg.UpdatedAt,
		client:    cli,
		mchid:     cfg.Mchid,
		appid:     cfg.AppId,
	}, nil
}

// getClient returns a cached client for the tenant, or builds a fresh one.
// Stale cache (config updated_at moved) is re-loaded.
func getClient(ctx context.Context, tid int) (*cachedClient, error) {
	if e, ok := cache.lookup(tid); ok {
		// Cheap staleness check: compare UpdatedAt against DB. A more scalable
		// alternative is to require callers to Invalidate on change (which the
		// controller layer does). This double check costs a tiny DB roundtrip
		// per payment op but eliminates stale-cache footguns in multi-replica
		// setups; S1 errs on the side of safety.
		cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
		if err == nil && cfg.UpdatedAt == e.updatedAt {
			return e, nil
		}
	}
	fresh, err := buildClient(ctx, tid)
	if err != nil {
		return nil, err
	}
	cache.store(tid, fresh)
	return fresh, nil
}

// callWithTimeout applies a short default timeout to any wechat API call.
func callWithTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 10*time.Second)
}
