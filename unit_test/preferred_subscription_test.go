package unit_test

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

// ============================================================
// 1. UserSetting — PreferredSubscriptionId JSON serialization
// ============================================================

func TestUserSetting_PreferredSubscriptionId_Serialize(t *testing.T) {
	setting := dto.UserSetting{
		BillingPreference:       "subscription_first",
		PreferredSubscriptionId: 42,
	}
	data, err := json.Marshal(setting)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal map failed: %v", err)
	}
	val, ok := parsed["preferred_subscription_id"]
	if !ok {
		t.Fatal("preferred_subscription_id not found in JSON output")
	}
	if int(val.(float64)) != 42 {
		t.Fatalf("expected 42, got %v", val)
	}
}

func TestUserSetting_PreferredSubscriptionId_Deserialize(t *testing.T) {
	jsonStr := `{"billing_preference":"wallet_first","preferred_subscription_id":99}`
	var setting dto.UserSetting
	if err := json.Unmarshal([]byte(jsonStr), &setting); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if setting.PreferredSubscriptionId != 99 {
		t.Fatalf("expected 99, got %d", setting.PreferredSubscriptionId)
	}
	if setting.BillingPreference != "wallet_first" {
		t.Fatalf("expected wallet_first, got %s", setting.BillingPreference)
	}
}

func TestUserSetting_PreferredSubscriptionId_Zero(t *testing.T) {
	// Zero value means "auto select" — should serialize as 0
	setting := dto.UserSetting{
		BillingPreference:       "subscription_first",
		PreferredSubscriptionId: 0,
	}
	data, err := json.Marshal(setting)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal map failed: %v", err)
	}
	// With no omitempty on int, zero should still be present
	val, ok := parsed["preferred_subscription_id"]
	if !ok {
		t.Fatal("preferred_subscription_id should be present even when 0")
	}
	if int(val.(float64)) != 0 {
		t.Fatalf("expected 0, got %v", val)
	}
}

func TestUserSetting_PreferredSubscriptionId_MissingField(t *testing.T) {
	// When field is missing from JSON, should default to 0
	jsonStr := `{"billing_preference":"subscription_first"}`
	var setting dto.UserSetting
	if err := json.Unmarshal([]byte(jsonStr), &setting); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if setting.PreferredSubscriptionId != 0 {
		t.Fatalf("expected 0, got %d", setting.PreferredSubscriptionId)
	}
}

// ============================================================
// 2. reorderSubscriptionsWithPreferred — reorder logic
// ============================================================

// helper to build test subscriptions
func makeSubs(ids ...int) []model.UserSubscription {
	subs := make([]model.UserSubscription, len(ids))
	for i, id := range ids {
		subs[i] = model.UserSubscription{Id: id}
	}
	return subs
}

func getIds(subs []model.UserSubscription) []int {
	ids := make([]int, len(subs))
	for i, s := range subs {
		ids[i] = s.Id
	}
	return ids
}

func sliceEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestReorder_PreferredFirst(t *testing.T) {
	// Preferred is at index 2 — should move to front
	subs := makeSubs(1, 2, 3, 4)
	model.ReorderSubscriptionsWithPreferred(subs, 3)
	got := getIds(subs)
	want := []int{3, 1, 2, 4}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_PreferredAlreadyFirst(t *testing.T) {
	// Preferred is already at front — no change
	subs := makeSubs(5, 6, 7)
	model.ReorderSubscriptionsWithPreferred(subs, 5)
	got := getIds(subs)
	want := []int{5, 6, 7}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_PreferredLast(t *testing.T) {
	// Preferred is at end
	subs := makeSubs(10, 20, 30)
	model.ReorderSubscriptionsWithPreferred(subs, 30)
	got := getIds(subs)
	want := []int{30, 10, 20}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_PreferredMiddle(t *testing.T) {
	// Preferred is second of five
	subs := makeSubs(1, 2, 3, 4, 5)
	model.ReorderSubscriptionsWithPreferred(subs, 2)
	got := getIds(subs)
	want := []int{2, 1, 3, 4, 5}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_PreferredNotFound(t *testing.T) {
	// ID not in list — no change
	subs := makeSubs(1, 2, 3)
	model.ReorderSubscriptionsWithPreferred(subs, 99)
	got := getIds(subs)
	want := []int{1, 2, 3}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_ZeroPreferred(t *testing.T) {
	// preferredSubId == 0 means auto — no reorder
	subs := makeSubs(1, 2, 3)
	model.ReorderSubscriptionsWithPreferred(subs, 0)
	got := getIds(subs)
	want := []int{1, 2, 3}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_NegativePreferred(t *testing.T) {
	// Negative — no reorder
	subs := makeSubs(1, 2, 3)
	model.ReorderSubscriptionsWithPreferred(subs, -5)
	got := getIds(subs)
	want := []int{1, 2, 3}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_SingleElement(t *testing.T) {
	// Single element — no change needed
	subs := makeSubs(1)
	model.ReorderSubscriptionsWithPreferred(subs, 1)
	got := getIds(subs)
	want := []int{1}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_EmptySlice(t *testing.T) {
	// Empty slice — no panic
	subs := makeSubs()
	model.ReorderSubscriptionsWithPreferred(subs, 1)
	if len(subs) != 0 {
		t.Fatal("expected empty slice")
	}
}

func TestReorder_TwoElements_PreferSecond(t *testing.T) {
	subs := makeSubs(1, 2)
	model.ReorderSubscriptionsWithPreferred(subs, 2)
	got := getIds(subs)
	want := []int{2, 1}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_TwoElements_PreferFirst(t *testing.T) {
	subs := makeSubs(1, 2)
	model.ReorderSubscriptionsWithPreferred(subs, 1)
	got := getIds(subs)
	want := []int{1, 2}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestReorder_PreservesOriginalOrder(t *testing.T) {
	// After moving preferred to front, remaining items should keep their relative order
	subs := makeSubs(10, 20, 30, 40, 50)
	model.ReorderSubscriptionsWithPreferred(subs, 40)
	got := getIds(subs)
	// 40 moves to front; 10,20,30 stay before 50
	want := []int{40, 10, 20, 30, 50}
	if !sliceEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}
