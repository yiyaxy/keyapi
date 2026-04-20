package model

import (
	"reflect"
	"testing"
)

func TestAbilityHasScopeField(t *testing.T) {
	a := Ability{}
	v := reflect.TypeOf(a)
	f, ok := v.FieldByName("Scope")
	if !ok {
		t.Fatal("Ability.Scope field missing")
	}
	if f.Type.Kind() != reflect.String {
		t.Fatalf("Ability.Scope should be string, got %s", f.Type.Kind())
	}
}
