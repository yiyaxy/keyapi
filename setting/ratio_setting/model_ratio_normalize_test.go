package ratio_setting

import "testing"

func TestFormatMatchingModelNameTrimsOuterWhitespace(t *testing.T) {
	got := FormatMatchingModelName(" claude-sonnet-4-6 ")
	if got != "claude-sonnet-4-6" {
		t.Fatalf("FormatMatchingModelName() = %q, want %q", got, "claude-sonnet-4-6")
	}
}

func TestUpdateModelRatioByJSONStringNormalizesKeysAndPreservesExact(t *testing.T) {
	original := ModelRatio2JSONString()
	t.Cleanup(func() {
		if err := UpdateModelRatioByJSONString(original); err != nil {
			t.Fatalf("restore model ratio: %v", err)
		}
	})

	err := UpdateModelRatioByJSONString(`{" claude-sonnet-4-6":37.5,"claude-sonnet-4-6":1.5}`)
	if err != nil {
		t.Fatalf("UpdateModelRatioByJSONString() error = %v", err)
	}

	ratio, ok, matchName := GetModelRatio(" claude-sonnet-4-6 ")
	if !ok {
		t.Fatalf("GetModelRatio() ok = false, matchName = %q", matchName)
	}
	if ratio != 1.5 {
		t.Fatalf("GetModelRatio() = %v, want 1.5", ratio)
	}

	if _, exists := GetModelRatioCopy()[" claude-sonnet-4-6"]; exists {
		t.Fatal("dirty model ratio key was retained")
	}
}

func TestCacheRatioLookupTrimsOuterWhitespace(t *testing.T) {
	original := CacheRatio2JSONString()
	t.Cleanup(func() {
		if err := UpdateCacheRatioByJSONString(original); err != nil {
			t.Fatalf("restore cache ratio: %v", err)
		}
	})

	if err := UpdateCacheRatioByJSONString(`{"claude-sonnet-4-6":0.1}`); err != nil {
		t.Fatalf("UpdateCacheRatioByJSONString() error = %v", err)
	}

	ratio, ok := GetCacheRatio(" claude-sonnet-4-6 ")
	if !ok {
		t.Fatal("GetCacheRatio() ok = false")
	}
	if ratio != 0.1 {
		t.Fatalf("GetCacheRatio() = %v, want 0.1", ratio)
	}
}
