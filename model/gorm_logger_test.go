package model

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type dummyRow struct {
	ID   uint `gorm:"primaryKey"`
	Name string
}

func captureWriters(t *testing.T) (out, errBuf *bytes.Buffer, restore func()) {
	t.Helper()
	common.LogWriterMu.Lock()
	origOut := gin.DefaultWriter
	origErr := gin.DefaultErrorWriter
	out = &bytes.Buffer{}
	errBuf = &bytes.Buffer{}
	gin.DefaultWriter = out
	gin.DefaultErrorWriter = errBuf
	common.LogWriterMu.Unlock()
	return out, errBuf, func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = origOut
		gin.DefaultErrorWriter = origErr
		common.LogWriterMu.Unlock()
	}
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormLogger := newPrettyGormLogger().LogMode(logger.Info)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormLogger})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&dummyRow{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestGormLogger_WritesTraceIdToDefaultWriter(t *testing.T) {
	out, _, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-abcd1234ef567890")
	defer trace.Clear()

	db := openTestDB(t)
	if err := db.Create(&dummyRow{Name: "alice"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	got := out.String()
	if !strings.Contains(got, "TEST-abcd1234ef567890") {
		t.Fatalf("expected trace id in [SQL] line, got:\n%s", got)
	}
	if !strings.Contains(got, "[SQL]") {
		t.Fatalf("expected [SQL] prefix, got:\n%s", got)
	}
}

func TestGormLogger_UnsetTracePrintsDash(t *testing.T) {
	out, _, restore := captureWriters(t)
	defer restore()

	trace.Clear()

	db := openTestDB(t)
	if err := db.Create(&dummyRow{Name: "bob"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	got := out.String()
	if !strings.Contains(got, "- ") {
		t.Fatalf("expected '-' placeholder when trace unset, got:\n%s", got)
	}
}

func TestGormLogger_ErrorGoesToErrorWriterOnly(t *testing.T) {
	out, errBuf, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-error0000000000")
	defer trace.Clear()

	db := openTestDB(t)
	_ = db.Raw("SELECT * FROM table_that_does_not_exist").Scan(&struct{}{}).Error

	gotErr := errBuf.String()
	gotOut := out.String()

	if !strings.Contains(gotErr, "[SQL ERR]") {
		t.Fatalf("expected [SQL ERR] on errBuf, got errBuf=%q", gotErr)
	}
	if !strings.Contains(gotErr, "TEST-error0000000000") {
		t.Fatalf("expected trace id on error line, got errBuf=%q", gotErr)
	}
	if strings.Contains(gotOut, "[SQL ERR]") {
		t.Fatalf("[SQL ERR] leaked into DefaultWriter, out=%q", gotOut)
	}
}

func TestGormLogger_NormalSQLDoesNotWriteErrorWriter(t *testing.T) {
	out, errBuf, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-normal0000000000")
	defer trace.Clear()

	db := openTestDB(t).WithContext(context.Background())
	if err := db.Create(&dummyRow{Name: "carol"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	if errBuf.Len() != 0 {
		t.Fatalf("normal SQL wrote to ErrorWriter, content=%q", errBuf.String())
	}
	if out.Len() == 0 {
		t.Fatalf("normal SQL did not write to DefaultWriter")
	}
}
