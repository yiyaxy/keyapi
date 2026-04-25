package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestReloadOption_RefreshesOptionMapFromDB(t *testing.T) {
	// Migrate Option table — TestMain doesn't include it
	if err := DB.AutoMigrate(&Option{}); err != nil {
		t.Fatalf("migrate Option: %v", err)
	}
	t.Cleanup(func() { DB.Exec("DELETE FROM options") })

	// Initialize OptionMap if nil
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()

	// 写一条 Option 到 DB（绕过 UpdateOption，避免触发后续的 publish 副作用）
	if err := DB.Save(&Option{Key: "SystemName", Value: "first"}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	common.OptionMapRWMutex.Lock()
	common.OptionMap["SystemName"] = "first"
	common.OptionMapRWMutex.Unlock()

	// 模拟另一实例改了 DB
	if err := DB.Model(&Option{}).Where("`key` = ?", "SystemName").Update("value", "second").Error; err != nil {
		t.Fatalf("update: %v", err)
	}

	if err := ReloadOption("SystemName"); err != nil {
		t.Fatalf("reload: %v", err)
	}

	common.OptionMapRWMutex.RLock()
	got := common.OptionMap["SystemName"]
	common.OptionMapRWMutex.RUnlock()
	if got != "second" {
		t.Fatalf("OptionMap should be reloaded to 'second', got %q", got)
	}
}
