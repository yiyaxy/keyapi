package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
)

func TestGetChannelMonitorData_IncludesVisiblePlatformChannelsForTenant(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := int(time.Now().UnixNano()%100000) + 900000
	group := fmt.Sprintf("monitor-platform-%d", tenantId)
	ch := Channel{
		Name:        group,
		Type:        1,
		Scope:       ChannelScopePlatform,
		TenantId:    0,
		Key:         "k",
		Status:      common.ChannelStatusEnabled,
		Models:      "monitor-model",
		Group:       group,
		CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	t.Cleanup(func() {
		_ = WithTenantBypass(DB).Delete(&Channel{}, ch.Id).Error
	})

	data, err := GetChannelMonitorData(tenantId)
	if err != nil {
		t.Fatalf("GetChannelMonitorData: %v", err)
	}

	item := findMonitorChannel(data, group, ch.Id)
	if item == nil {
		t.Fatalf("expected tenant monitor to include platform channel %d in group %q, got %+v", ch.Id, group, data.Groups)
	}
}

func TestGetChannelMonitorData_HidesAdminLockedPlatformChannelsForTenant(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := int(time.Now().UnixNano()%100000) + 910000
	group := fmt.Sprintf("monitor-platform-locked-%d", tenantId)
	ch := Channel{
		Name:        group,
		Type:        1,
		Scope:       ChannelScopePlatform,
		TenantId:    0,
		Key:         "k",
		Status:      common.ChannelStatusEnabled,
		Models:      "monitor-model",
		Group:       group,
		CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	t.Cleanup(func() {
		_ = SetTenantChannelDisabledAsAdmin(tenantId, ch.Id, false)
		_ = WithTenantBypass(DB).Delete(&Channel{}, ch.Id).Error
	})
	if err := SetTenantChannelDisabledAsAdmin(tenantId, ch.Id, true); err != nil {
		t.Fatalf("lock platform channel: %v", err)
	}

	data, err := GetChannelMonitorData(tenantId)
	if err != nil {
		t.Fatalf("GetChannelMonitorData: %v", err)
	}
	if item := findMonitorChannel(data, group, ch.Id); item != nil {
		t.Fatalf("admin-locked platform channel should be hidden from tenant monitor, got %+v", *item)
	}
}

func findMonitorChannel(data *ChannelMonitorData, group string, channelID int) *ChannelMonitorItem {
	if data == nil {
		return nil
	}
	for _, g := range data.Groups {
		if g.GroupKey != group {
			continue
		}
		for i := range g.Channels {
			if g.Channels[i].ChannelId == channelID {
				return &g.Channels[i]
			}
		}
	}
	return nil
}
