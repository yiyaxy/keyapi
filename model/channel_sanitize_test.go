package model

import (
	"testing"
)

func TestSanitizeForTenantView_PlatformStripsSensitive(t *testing.T) {
	setting := `{"proxy":"http://...","system_prompt":"x"}`
	header := `{"X-Foo":"{api_key}"}`
	paramOv := `{"temperature":0.5}`
	statusMap := `{"429":"retry"}`
	autoBan := 1
	mkp := 1.2

	c := &Channel{
		Id: 1, Name: "p", Type: 1, Scope: ChannelScopePlatform,
		BaseURL:           nil, // *string; set below
		Key:               "sk-secret",
		Setting:           &setting,
		HeaderOverride:    &header,
		ParamOverride:     &paramOv,
		OtherSettings:     `{"vertex_key_type":"api_key","secret":"x"}`,
		Other:             "us-central1",
		StatusCodeMapping: &statusMap,
		AutoBan:           &autoBan,
		Balance:           100,
		UsedQuota:         50,
		MarkupRatio:       &mkp,
		ChannelInfo: ChannelInfo{
			IsMultiKey:             true,
			MultiKeyStatusList:     map[int]int{0: 2},
			MultiKeyDisabledReason: map[int]string{0: "banned"},
		},
	}
	baseURL := "https://api.openai.com/v1"
	c.BaseURL = &baseURL

	SanitizeForTenantView(c)

	if c.Key != "" {
		t.Error("Key should be empty")
	}
	if c.Setting != nil && *c.Setting != "" {
		t.Error("Setting should be stripped")
	}
	if c.HeaderOverride != nil && *c.HeaderOverride != "" {
		t.Error("HeaderOverride should be stripped")
	}
	if c.ParamOverride != nil && *c.ParamOverride != "" {
		t.Error("ParamOverride should be stripped")
	}
	if c.Other != "" {
		t.Error("Other should be stripped")
	}
	if c.BaseURL != nil && *c.BaseURL != "" {
		t.Error("BaseURL should be stripped")
	}
	if c.Balance != 0 {
		t.Error("Balance should be zero")
	}
	if c.UsedQuota != 0 {
		t.Error("UsedQuota should be zero")
	}
	if c.ChannelInfo.MultiKeyStatusList != nil {
		t.Error("MultiKeyStatusList should be nil")
	}
	if c.ChannelInfo.MultiKeyDisabledReason != nil {
		t.Error("MultiKeyDisabledReason should be nil")
	}
	if c.MarkupRatio == nil || *c.MarkupRatio != 1.2 {
		t.Error("MarkupRatio should be preserved")
	}
	if c.Name != "p" {
		t.Error("Name should be preserved")
	}
}

func TestSanitizeForTenantView_TenantOnlyOmitsKey(t *testing.T) {
	setting := `{"proxy":"local"}`
	c := &Channel{
		Id: 2, Name: "own", Scope: ChannelScopeTenant, TenantId: 7,
		Key: "sk-my-key", Setting: &setting, Balance: 42,
	}
	SanitizeForTenantView(c)
	if c.Key != "" {
		t.Error("Key should be stripped even for owned channels (defense in depth)")
	}
	if c.Setting == nil || *c.Setting == "" {
		t.Error("own Setting must be preserved")
	}
	if c.Balance == 0 {
		t.Error("own Balance must be preserved")
	}
}

func TestSanitizeForCopy_StripsKeyAndSensitive(t *testing.T) {
	setting := `{"proxy":"x"}`
	header := `{"H":"v"}`
	paramOv := `{"p":1}`
	src := &Channel{
		Id: 1, Name: "src", Type: 1, Models: "gpt-4o", Group: "default",
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "sk-secret", Setting: &setting, HeaderOverride: &header, ParamOverride: &paramOv,
		OtherSettings: "x", Other: "y",
		Balance: 99, UsedQuota: 50, TestTime: 1, ResponseTime: 2,
		ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeyStatusList: map[int]int{0: 1}},
	}
	dst := SanitizeForCopy(src, 7) // target tenantId
	if dst.Id != 0 {
		t.Error("Id must be 0 for new row")
	}
	if dst.Scope != ChannelScopeTenant {
		t.Error("Copy must land as tenant scope")
	}
	if dst.TenantId != 7 {
		t.Error("TenantId must be target tenant")
	}
	if dst.Key != "" {
		t.Error("Key must not be copied")
	}
	if dst.HeaderOverride != nil && *dst.HeaderOverride != "" {
		t.Error("HeaderOverride must not be copied")
	}
	if dst.ParamOverride != nil && *dst.ParamOverride != "" {
		t.Error("ParamOverride must not be copied")
	}
	if dst.OtherSettings != "" {
		t.Error("OtherSettings must not be copied")
	}
	if dst.Other != "" {
		t.Error("Other must not be copied")
	}
	if dst.Balance != 0 || dst.UsedQuota != 0 || dst.TestTime != 0 || dst.ResponseTime != 0 {
		t.Error("balance/quota/test/response must be zeroed")
	}
	if dst.ChannelInfo.IsMultiKey || dst.ChannelInfo.MultiKeyStatusList != nil {
		t.Error("ChannelInfo multi-key state must not be copied")
	}
	// Whitelist preserved:
	if dst.Name != "src" || dst.Type != 1 || dst.Models != "gpt-4o" || dst.Group != "default" {
		t.Error("whitelist fields (Name, Type, Models, Group) must be preserved")
	}
}
