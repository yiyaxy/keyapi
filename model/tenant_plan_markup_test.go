package model

import (
	"reflect"
	"testing"
)

func TestTenantPlanHasPlatformMarkup(t *testing.T) {
	p := TenantPlan{}
	v := reflect.TypeOf(p)
	f, ok := v.FieldByName("PlatformMarkup")
	if !ok {
		t.Fatal("TenantPlan.PlatformMarkup missing")
	}
	if f.Type.Kind() != reflect.Float64 {
		t.Fatalf("PlatformMarkup should be float64, got %s", f.Type.Kind())
	}
}
