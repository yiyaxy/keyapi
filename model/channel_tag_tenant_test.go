package model

import "testing"

func TestGetChannelsByTagForTenant_IncludesPlatformExcludesOthers(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tag := "test-tag-xyz"
	p := Channel{Name: "p", Tag: &tag, Scope: ChannelScopePlatform, TenantId: 0, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	mine := Channel{Name: "mine", Tag: &tag, Scope: ChannelScopeTenant, TenantId: 7, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	other := Channel{Name: "other", Tag: &tag, Scope: ChannelScopeTenant, TenantId: 8, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	for _, c := range []*Channel{&p, &mine, &other} {
		if err := WithTenantBypass(DB).Create(c).Error; err != nil {
			t.Fatal(err)
		}
		defer WithTenantBypass(DB).Delete(&Channel{}, c.Id)
	}

	rows, err := GetChannelsByTagForTenant(tag, 7, false, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[int]bool{}
	for _, r := range rows {
		ids[r.Id] = true
	}
	if !ids[p.Id] {
		t.Error("must include platform channel")
	}
	if !ids[mine.Id] {
		t.Error("must include own tenant channel")
	}
	if ids[other.Id] {
		t.Error("must NOT include other tenant's channel")
	}
}

func TestGetPaginatedTagsForTenant_ScopeFilter(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	pTag := "platform-tag-only"
	myTag := "my-tag-only"
	otherTag := "other-tag-only"
	p := Channel{Name: "tp", Tag: &pTag, Scope: ChannelScopePlatform, TenantId: 0, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	mine := Channel{Name: "tm", Tag: &myTag, Scope: ChannelScopeTenant, TenantId: 7, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	other := Channel{Name: "to", Tag: &otherTag, Scope: ChannelScopeTenant, TenantId: 8, Type: 1, Key: "k", Status: 1, CreatedTime: 1}
	for _, c := range []*Channel{&p, &mine, &other} {
		if err := WithTenantBypass(DB).Create(c).Error; err != nil {
			t.Fatal(err)
		}
		defer WithTenantBypass(DB).Delete(&Channel{}, c.Id)
	}

	tags, err := GetPaginatedTagsForTenant(7, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, tg := range tags {
		if tg != nil {
			seen[*tg] = true
		}
	}
	if !seen[pTag] {
		t.Error("platform tag should be visible")
	}
	if !seen[myTag] {
		t.Error("own tag should be visible")
	}
	if seen[otherTag] {
		t.Error("other tenant's tag should NOT be visible")
	}
}
