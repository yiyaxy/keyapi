package model

import (
	"strings"
	"testing"
)

func TestBuildOutTradeNo_PrefixAndLength(t *testing.T) {
	no, err := BuildOutTradeNo(1, "topup")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(no, "wx_t1_T_") {
		t.Fatalf("bad prefix: %s", no)
	}
	if len(no) > 32 {
		t.Fatalf("out_trade_no too long (%d > 32): %s", len(no), no)
	}
}

func TestBuildOutTradeNo_SubKind(t *testing.T) {
	no, err := BuildOutTradeNo(42, "sub")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(no, "wx_t42_S_") {
		t.Fatalf("bad prefix: %s", no)
	}
}

func TestBuildOutTradeNo_InvalidType(t *testing.T) {
	if _, err := BuildOutTradeNo(1, "bogus"); err == nil {
		t.Fatal("expected error for unknown order type")
	}
}

func TestBuildOutTradeNo_InvalidTenant(t *testing.T) {
	if _, err := BuildOutTradeNo(0, "topup"); err == nil {
		t.Fatal("expected error for tenant_id <= 0")
	}
}

func TestBuildOutTradeNo_MaxTenantLen(t *testing.T) {
	no, err := BuildOutTradeNo(9999999, "sub")
	if err != nil {
		t.Fatal(err)
	}
	if len(no) > 32 {
		t.Fatalf("overflow at 7-digit tid: %d chars: %s", len(no), no)
	}
}

func TestValidateOutTradeNo_MatchesRoute(t *testing.T) {
	no, _ := BuildOutTradeNo(123, "topup")
	if err := ValidateOutTradeNoRoute(no, 123, "topup"); err != nil {
		t.Fatalf("expected match, got %v", err)
	}
	if err := ValidateOutTradeNoRoute(no, 124, "topup"); err == nil {
		t.Fatal("wrong tenant should fail")
	}
	if err := ValidateOutTradeNoRoute(no, 123, "sub"); err == nil {
		t.Fatal("wrong order type should fail")
	}
	if err := ValidateOutTradeNoRoute("garbage", 123, "topup"); err == nil {
		t.Fatal("garbage should fail")
	}
}
