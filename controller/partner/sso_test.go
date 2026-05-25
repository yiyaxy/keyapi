package partner

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupPartnerQueryTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := model.DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL

	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	model.InitColForTest()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.PartnerUser{}, &model.Token{}, &model.UserIpRecord{}); err != nil {
		t.Fatalf("migrate partner query tables: %v", err)
	}
	model.DB = db

	return func() {
		model.DB = prevDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
		model.InitColForTest()
	}
}

func TestListPartnerUsersWithoutExternalUserIdsReturnsAllForClient(t *testing.T) {
	restoreDB := setupPartnerQueryTestDB(t)
	defer restoreDB()

	users := []model.User{
		{TenantId: 33, Username: "alice", DisplayName: "Alice", Email: "alice@example.com", AffCode: "a001"},
		{TenantId: 33, Username: "bob", DisplayName: "Bob", Email: "bob@example.com", AffCode: "b001"},
		{TenantId: 33, Username: "other", DisplayName: "Other", Email: "other@example.com", AffCode: "o001"},
	}
	if err := model.WithTenantBypass(model.DB).Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	bindings := []model.PartnerUser{
		{TenantId: 33, ClientId: "tenant_33", ExternalUserId: "ext_alice", UserId: users[0].Id},
		{TenantId: 33, ClientId: "tenant_33", ExternalUserId: "ext_bob", UserId: users[1].Id},
		{TenantId: 33, ClientId: "another_client", ExternalUserId: "ext_other", UserId: users[2].Id},
	}
	if err := model.WithTenantBypass(model.DB).Create(&bindings).Error; err != nil {
		t.Fatalf("create partner bindings: %v", err)
	}

	items, total, err := listPartnerUsers(33, usersQueryRequest{
		ClientId: "tenant_33",
		Page:     1,
		PageSize: 100,
	})
	if err != nil {
		t.Fatalf("list all partner users: %v", err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("got total=%d len=%d, want total=2 len=2", total, len(items))
	}
	got := map[string]bool{}
	for _, item := range items {
		got[item.ExternalUserId] = true
	}
	if !got["ext_alice"] || !got["ext_bob"] || got["ext_other"] {
		t.Fatalf("unexpected external users: %#v", got)
	}

	items, total, err = listPartnerUsers(33, usersQueryRequest{
		ClientId:        "tenant_33",
		ExternalUserIds: []string{" ext_alice "},
		Page:            1,
		PageSize:        100,
	})
	if err != nil {
		t.Fatalf("list filtered partner users: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ExternalUserId != "ext_alice" {
		t.Fatalf("filtered result = total=%d items=%#v, want only ext_alice", total, items)
	}
}
