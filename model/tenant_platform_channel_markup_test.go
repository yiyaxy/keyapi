package model

import "testing"

func TestTenantPlatformChannelMarkup_FieldsCompile(t *testing.T) {
	row := TenantPlatformChannelMarkup{
		TenantId:    1,
		ChannelId:   2,
		MarkupRatio: 1.5,
		Enabled:     true,
	}
	if row.TenantId != 1 || row.ChannelId != 2 || row.MarkupRatio != 1.5 || !row.Enabled {
		t.Fatalf("unexpected row: %+v", row)
	}
}
