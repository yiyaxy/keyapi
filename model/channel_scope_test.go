package model

import (
	"reflect"
	"testing"
)

func TestChannelHasScopeAndMarkupFields(t *testing.T) {
	c := Channel{}
	v := reflect.TypeOf(c)
	scopeField, ok := v.FieldByName("Scope")
	if !ok {
		t.Fatal("Channel.Scope field missing")
	}
	if scopeField.Type.Kind() != reflect.String {
		t.Fatalf("Channel.Scope should be string, got %s", scopeField.Type.Kind())
	}
	markupField, ok := v.FieldByName("MarkupRatio")
	if !ok {
		t.Fatal("Channel.MarkupRatio field missing")
	}
	// *float64 (nullable)
	if markupField.Type.Kind() != reflect.Ptr || markupField.Type.Elem().Kind() != reflect.Float64 {
		t.Fatalf("Channel.MarkupRatio should be *float64, got %s", markupField.Type)
	}
}

func TestChannelScopeConstants(t *testing.T) {
	if ChannelScopePlatform != "platform" {
		t.Errorf("ChannelScopePlatform = %q, want \"platform\"", ChannelScopePlatform)
	}
	if ChannelScopeTenant != "tenant" {
		t.Errorf("ChannelScopeTenant = %q, want \"tenant\"", ChannelScopeTenant)
	}
}
