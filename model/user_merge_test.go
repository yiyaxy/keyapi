package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

func setupUserMergeTestDB(t *testing.T) func() {
	t.Helper()

	prevDB := DB
	prevLOGDB := LOG_DB
	prevUsingSQLite := common.UsingSQLite
	prevUsingPostgreSQL := common.UsingPostgreSQL
	prevUsingMySQL := common.UsingMySQL

	InitColForTest()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	DB = db
	LOG_DB = db

	return func() {
		DB = prevDB
		LOG_DB = prevLOGDB
		common.UsingSQLite = prevUsingSQLite
		common.UsingPostgreSQL = prevUsingPostgreSQL
		common.UsingMySQL = prevUsingMySQL
	}
}

func TestReassignUserIdUsesActualOwnerColumns(t *testing.T) {
	restore := setupUserMergeTestDB(t)
	defer restore()

	if err := DB.AutoMigrate(
		&TicketReply{},
		&TicketAttachment{},
		&InvoiceUpload{},
		&Message{},
		&MessageReadStatus{},
		&UserRebateSetting{},
		&AffRebateLog{},
	); err != nil {
		t.Fatalf("migrate tables: %v", err)
	}

	if err := DB.Create(&TicketReply{TenantId: 1, TicketId: 1, Role: "user", SenderId: 20, Content: "reply"}).Error; err != nil {
		t.Fatalf("create ticket reply: %v", err)
	}
	if err := DB.Create(&TicketAttachment{TenantId: 1, TicketId: 1, UploaderId: 20, ObjectKey: "att-1", OriginalFilename: "a.txt", ContentType: "text/plain"}).Error; err != nil {
		t.Fatalf("create ticket attachment: %v", err)
	}
	if err := DB.Create(&InvoiceUpload{TenantId: 1, UploaderId: 20, ObjectKey: "inv-up-1", OriginalFilename: "i.txt"}).Error; err != nil {
		t.Fatalf("create invoice upload: %v", err)
	}
	if err := DB.Create(&Message{TenantId: 1, Title: "direct", Type: MessageTypeDirected, TargetUserId: 20, SenderId: 20}).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	if err := DB.Create(&AffRebateLog{TenantId: 1, UserId: 20, InviteeId: 20, Type: AffRebateTypeTopUp}).Error; err != nil {
		t.Fatalf("create rebate log: %v", err)
	}

	readRows := []MessageReadStatus{
		{TenantId: 1, MessageId: 1, UserId: 10},
		{TenantId: 1, MessageId: 1, UserId: 20},
		{TenantId: 1, MessageId: 2, UserId: 20},
	}
	for i := range readRows {
		if err := DB.Create(&readRows[i]).Error; err != nil {
			t.Fatalf("create read status %d: %v", i, err)
		}
	}

	settings := []UserRebateSetting{
		{InviterId: 10, RegisterReward: 1},
		{InviterId: 20, RegisterReward: 2},
	}
	for i := range settings {
		if err := DB.Create(&settings[i]).Error; err != nil {
			t.Fatalf("create rebate setting %d: %v", i, err)
		}
	}

	for _, table := range []string{
		"ticket_replies",
		"ticket_attachments",
		"invoice_uploads",
		"messages",
		"message_read_statuses",
		"user_rebate_settings",
		"aff_rebate_logs",
	} {
		if err := reassignUserId(DB, table, 20, 10); err != nil {
			t.Fatalf("reassign %s: %v", table, err)
		}
	}

	var count int64
	DB.Model(&TicketReply{}).Where("sender_id = ?", 20).Count(&count)
	if count != 0 {
		t.Fatalf("source ticket replies = %d, want 0", count)
	}
	DB.Model(&TicketAttachment{}).Where("uploader_id = ?", 20).Count(&count)
	if count != 0 {
		t.Fatalf("source ticket attachments = %d, want 0", count)
	}
	DB.Model(&InvoiceUpload{}).Where("uploader_id = ?", 20).Count(&count)
	if count != 0 {
		t.Fatalf("source invoice uploads = %d, want 0", count)
	}
	DB.Model(&Message{}).Where("target_user_id = ? OR sender_id = ?", 20, 20).Count(&count)
	if count != 0 {
		t.Fatalf("source messages = %d, want 0", count)
	}
	DB.Model(&AffRebateLog{}).Where("user_id = ? OR invitee_id = ?", 20, 20).Count(&count)
	if count != 0 {
		t.Fatalf("source rebate logs = %d, want 0", count)
	}

	DB.Model(&MessageReadStatus{}).Where("user_id = ?", 20).Count(&count)
	if count != 0 {
		t.Fatalf("source read statuses = %d, want 0", count)
	}
	DB.Model(&MessageReadStatus{}).Where("user_id = ?", 10).Count(&count)
	if count != 2 {
		t.Fatalf("target read statuses = %d, want 2", count)
	}

	DB.Model(&UserRebateSetting{}).Where("inviter_id = ?", 20).Count(&count)
	if count != 0 {
		t.Fatalf("source rebate settings = %d, want 0", count)
	}
	DB.Model(&UserRebateSetting{}).Where("inviter_id = ?", 10).Count(&count)
	if count != 1 {
		t.Fatalf("target rebate settings = %d, want 1", count)
	}
}
