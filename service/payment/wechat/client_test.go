package wechat

import (
	"testing"
)

func TestCache_InvalidateRemovesEntry(t *testing.T) {
	c := newClientCache()
	// Store a non-nil placeholder to ensure we can observe removal.
	c.store(123, &cachedClient{tenantId: 123})
	if _, ok := c.lookup(123); !ok {
		t.Fatal("expected cached entry")
	}
	c.Invalidate(123)
	if _, ok := c.lookup(123); ok {
		t.Fatal("entry should be gone after invalidate")
	}
}
