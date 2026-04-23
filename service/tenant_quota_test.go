package service

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// resetTPMCounters 重置内存 TPM 计数器，测试前必调。
func resetTPMCounters() {
	tpmCounters = sync.Map{}
}

func TestIncrementTenantTPM_InMemory_Accumulates(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 100)
	IncrementTenantTPM(42, 250)

	entry := getTPMEntry(42)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.tokens != 350 {
		t.Fatalf("expected tokens=350, got %d", entry.tokens)
	}
	if entry.resetAt.Before(time.Now()) {
		t.Fatalf("resetAt should be in the future, got %v", entry.resetAt)
	}
}

func TestIncrementTenantTPM_ZeroOrNegativeIgnored(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(0, 100)  // tenantId 0
	IncrementTenantTPM(-1, 100) // tenantId negative
	IncrementTenantTPM(42, 0)   // tokens 0
	IncrementTenantTPM(42, -5)  // tokens negative

	count := 0
	tpmCounters.Range(func(_, _ any) bool { count++; return true })
	if count != 0 {
		t.Fatalf("expected no counters created, got %d", count)
	}
}

func TestCheckTenantTPMMemory_UnderLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 500)
	if err := checkTenantTPMMemory(42, 1000); err != nil {
		t.Fatalf("expected nil (under limit), got %v", err)
	}
}

func TestCheckTenantTPMMemory_AtLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 1000)
	err := checkTenantTPMMemory(42, 1000)
	if err == nil {
		t.Fatal("expected error when tokens == limit, got nil")
	}
	if !strings.Contains(err.Error(), "1000") {
		t.Fatalf("error should mention limit 1000, got: %s", err.Error())
	}
}

func TestCheckTenantTPMMemory_OverLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 1500)
	err := checkTenantTPMMemory(42, 1000)
	if err == nil {
		t.Fatal("expected error when tokens > limit, got nil")
	}
}

func TestCheckTenantTPMMemory_WindowExpiry(t *testing.T) {
	resetTPMCounters()
	entry := getTPMEntry(42)
	entry.mu.Lock()
	entry.tokens = 9999
	entry.resetAt = time.Now().Add(-1 * time.Second) // already expired
	entry.mu.Unlock()

	if err := checkTenantTPMMemory(42, 1000); err != nil {
		t.Fatalf("expected nil after window expiry, got %v", err)
	}
}

func TestEvaluateProjectedQuota_Unlimited(t *testing.T) {
	if err := evaluateProjectedQuota(-1, 99999, 99999); err != nil {
		t.Fatalf("expected nil for unlimited cap, got %v", err)
	}
}

func TestEvaluateProjectedQuota_FitsUnderCap(t *testing.T) {
	if err := evaluateProjectedQuota(10000, 5000, 1000); err != nil {
		t.Fatalf("expected nil when under cap, got %v", err)
	}
}

func TestEvaluateProjectedQuota_ExceedsCap(t *testing.T) {
	err := evaluateProjectedQuota(10000, 9500, 1000)
	if err == nil {
		t.Fatal("expected error when usage exceeds cap")
	}
	if !strings.Contains(err.Error(), "10000") {
		t.Fatalf("error should mention cap, got: %s", err.Error())
	}
}

func TestEvaluateProjectedQuota_AtCapBoundary(t *testing.T) {
	if err := evaluateProjectedQuota(10000, 10000, 1); err == nil {
		t.Fatal("expected error when already at cap")
	}
}

func TestEvaluateProjectedQuota_ZeroProjected(t *testing.T) {
	if err := evaluateProjectedQuota(10000, 10000, 0); err != nil {
		t.Fatalf("expected nil for zero projected, got %v", err)
	}
}

func TestIncrementTenantPlatformChannelUsed_GuardsAreNoOps(t *testing.T) {
	IncrementTenantPlatformChannelUsed(0, 100)
	IncrementTenantPlatformChannelUsed(-1, 100)
	IncrementTenantPlatformChannelUsed(42, 0)
	IncrementTenantPlatformChannelUsed(42, -5)
}
