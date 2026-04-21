package trace

import (
	"regexp"
	"sync"
	"testing"
)

func TestGet_Unset_ReturnsDash(t *testing.T) {
	Clear()
	if got := Get(); got != "-" {
		t.Fatalf("Get() on unset goroutine = %q, want %q", got, "-")
	}
}

func TestSet_Get_Roundtrip(t *testing.T) {
	Set("HTTP-abcdef0123456789")
	defer Clear()
	if got := Get(); got != "HTTP-abcdef0123456789" {
		t.Fatalf("Get() after Set = %q, want %q", got, "HTTP-abcdef0123456789")
	}
}

func TestNewHTTP_Format(t *testing.T) {
	id := NewHTTP()
	if ok, _ := regexp.MatchString(`^HTTP-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewHTTP() = %q, want HTTP-<16 hex>", id)
	}
}

func TestNewJob_Format(t *testing.T) {
	id := NewJob("subreset")
	if ok, _ := regexp.MatchString(`^JOB-subreset-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewJob(subreset) = %q, want JOB-subreset-<16 hex>", id)
	}
}

func TestNewSys_Format(t *testing.T) {
	id := NewSys("bootstrap")
	if ok, _ := regexp.MatchString(`^SYS-bootstrap-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewSys(bootstrap) = %q, want SYS-bootstrap-<16 hex>", id)
	}
}

func TestGoJob_AlwaysGeneratesNewTrace(t *testing.T) {
	Set("HTTP-parent0000000000")
	defer Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoJob("subreset", func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace == "HTTP-parent0000000000" {
		t.Fatalf("GoJob inherited parent trace %q, want fresh JOB-subreset-*", childTrace)
	}
	if ok, _ := regexp.MatchString(`^JOB-subreset-[0-9a-f]{16}$`, childTrace); !ok {
		t.Fatalf("GoJob child trace = %q, want JOB-subreset-<16 hex>", childTrace)
	}
}

func TestGoInherit_InheritsParentTrace(t *testing.T) {
	Set("HTTP-parent1111111111")
	defer Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoInherit(func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace != "HTTP-parent1111111111" {
		t.Fatalf("GoInherit child trace = %q, want %q", childTrace, "HTTP-parent1111111111")
	}
}

func TestGoInherit_NoParentMeansDash(t *testing.T) {
	Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoInherit(func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace != "-" {
		t.Fatalf("GoInherit without parent = %q, want %q", childTrace, "-")
	}
}

func TestGoJob_IsolationBetweenConcurrentGoroutines(t *testing.T) {
	var wg sync.WaitGroup
	results := make([]string, 10)
	for i := 0; i < 10; i++ {
		i := i
		wg.Add(1)
		GoJob("iso", func() {
			defer wg.Done()
			results[i] = Get()
		})
	}
	wg.Wait()

	seen := make(map[string]bool)
	for i, r := range results {
		if ok, _ := regexp.MatchString(`^JOB-iso-[0-9a-f]{16}$`, r); !ok {
			t.Fatalf("goroutine %d got %q, want JOB-iso-<16 hex>", i, r)
		}
		if seen[r] {
			t.Fatalf("duplicate trace id %q across goroutines (should be unique with 64-bit space)", r)
		}
		seen[r] = true
	}
}
