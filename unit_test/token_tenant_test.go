package unit_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"
)

// setupTokenTestDB opens a fresh in-memory SQLite, sets model.DB + column vars,
// migrates just the Token table, and returns the DB for convenience. Subsequent
// calls wipe state by reopening the DB. This intentionally bypasses InitDB()
// which would drag in migrations for 40+ tables and tenant callbacks — we only
// need the Token table and manual tenant_id assignment here.
func setupTokenTestDB(t *testing.T) {
	t.Helper()
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	// Trigger commonKeyCol init inside model package. InitDB() is too heavy;
	// we only need the column-name vars. A no-op call that routes through
	// the package-private initCol is unavailable, so we rely on the package
	// initializing via its own init chain OR we accept that GetTokenKeysByIds*
	// using backtick literal is SQLite-compatible. The safe path: invoke
	// InitExposedColumnVars which we add below to model/main.go — but to
	// avoid that round-trip, use raw SQL here: every Token query uses struct
	// field name `Key` through GORM which auto-quotes. The only reason
	// commonKeyCol exists is MySQL/PG reserved word quoting. In test with
	// SQLite we can bypass by setting the var directly via reflection-free
	// means: just set it to backtick-quoted form which SQLite also accepts.
	model.InitColForTest() // <-- helper we add in model package
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormLogger.Default.LogMode(gormLogger.Silent),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Token{}); err != nil {
		t.Fatalf("migrate Token: %v", err)
	}
	model.DB = db
}

// makeToken inserts one Token row bypassing tenant callbacks.
func makeToken(t *testing.T, id, userId, tenantId int, key string) model.Token {
	t.Helper()
	tok := model.Token{
		Id:       id,
		UserId:   userId,
		TenantId: tenantId,
		Key:      key,
		Name:     "t" + key,
		Status:   1,
	}
	if err := model.DB.Create(&tok).Error; err != nil {
		t.Fatalf("create token: %v", err)
	}
	return tok
}

func TestGetTokenByIdsTenant(t *testing.T) {
	setupTokenTestDB(t)
	_ = makeToken(t, 100, 1, 1, "kA")

	cases := []struct {
		name     string
		id       int
		userId   int
		tenantId int
		wantErr  bool
	}{
		{"same tenant same user", 100, 1, 1, false},
		{"same tenant different user", 100, 2, 1, true},
		{"cross tenant any user", 100, 1, 2, true},
		{"zero tenantId rejected", 100, 1, 0, true},
		{"zero userId rejected", 100, 0, 1, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := model.GetTokenByIdsTenant(c.id, c.userId, c.tenantId)
			if c.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestGetTokenKeysByIdsTenant(t *testing.T) {
	setupTokenTestDB(t)
	a := makeToken(t, 200, 1, 1, "kA")
	b := makeToken(t, 201, 1, 1, "kB")

	cases := []struct {
		name     string
		ids      []int
		userId   int
		tenantId int
		wantLen  int
	}{
		{"same tenant same user", []int{a.Id, b.Id}, 1, 1, 2},
		{"same tenant different user", []int{a.Id}, 2, 1, 0},
		{"cross tenant any user", []int{a.Id}, 1, 2, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			keys, err := model.GetTokenKeysByIdsTenant(c.ids, c.userId, c.tenantId)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(keys) != c.wantLen {
				t.Fatalf("want %d keys, got %d", c.wantLen, len(keys))
			}
		})
	}
	t.Run("zero userId rejected", func(t *testing.T) {
		_, err := model.GetTokenKeysByIdsTenant([]int{a.Id}, 0, 1)
		if err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("zero tenantId rejected", func(t *testing.T) {
		_, err := model.GetTokenKeysByIdsTenant([]int{a.Id}, 1, 0)
		if err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestDeleteTokenByIdTenant(t *testing.T) {
	cases := []struct {
		name        string
		userId      int
		tenantId    int
		wantErr     bool
		wantStillDB bool // row remains undeleted when cross-tenant or invalid
	}{
		{"same tenant same user", 1, 1, false, false},
		{"same tenant different user", 2, 1, true, true},
		{"cross tenant any user", 1, 2, true, true},
		{"zero tenantId rejected", 1, 0, true, true},
		{"zero userId rejected", 0, 1, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			setupTokenTestDB(t)
			row := makeToken(t, 300, 1, 1, "kX"+c.name)
			err := model.DeleteTokenByIdTenant(row.Id, c.userId, c.tenantId)
			if c.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Check final DB state (with Unscoped to see soft-deleted rows too)
			var found model.Token
			lookupErr := model.DB.Unscoped().Where("id = ?", row.Id).First(&found).Error
			if lookupErr != nil {
				t.Fatalf("lookup after delete: %v", lookupErr)
			}
			if c.wantStillDB {
				if !found.DeletedAt.Time.IsZero() {
					t.Fatalf("row should not be soft-deleted (cross-tenant/invalid delete)")
				}
			} else {
				if found.DeletedAt.Time.IsZero() {
					t.Fatalf("row should be soft-deleted after successful delete")
				}
			}
		})
	}
}
