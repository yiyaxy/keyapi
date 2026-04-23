package model

import (
	"testing"
	"time"
)

func TestComputePlatformQuotaPeriodReset_NoneNeverResets(t *testing.T) {
	yearAgo := time.Now().Add(-365 * 24 * time.Hour).Unix()
	need, _ := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodNone, yearAgo, time.Now())
	if need {
		t.Fatal("period=none must never reset")
	}
}

func TestComputePlatformQuotaPeriodReset_DailyAcrossBoundary(t *testing.T) {
	now := time.Now()
	yesterday := now.Add(-25 * time.Hour).Unix()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, yesterday, now)
	if !need {
		t.Fatal("daily period crossing midnight must reset")
	}
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	if newStart != startOfToday {
		t.Fatalf("expected newStart=%d, got %d", startOfToday, newStart)
	}
}

func TestComputePlatformQuotaPeriodReset_DailySameDay(t *testing.T) {
	now := time.Now()
	noon := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, now.Location())
	need, _ := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, noon.Unix(), noon.Add(2*time.Hour))
	if need {
		t.Fatal("same day must not reset")
	}
}

func TestComputePlatformQuotaPeriodReset_MonthlyAcrossBoundary(t *testing.T) {
	now := time.Now()
	lastMonth := time.Date(now.Year(), now.Month()-1, 15, 12, 0, 0, 0, now.Location()).Unix()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodMonthly, lastMonth, now)
	if !need {
		t.Fatal("monthly period crossing must reset")
	}
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
	if newStart != startOfMonth {
		t.Fatalf("expected newStart=%d, got %d", startOfMonth, newStart)
	}
}

func TestComputePlatformQuotaPeriodReset_ZeroStartInitializesActivePeriod(t *testing.T) {
	now := time.Now()
	need, newStart := ComputePlatformQuotaPeriodReset(PlatformQuotaPeriodDaily, 0, now)
	if !need {
		t.Fatal("zero period_start must trigger initialization for daily")
	}
	if newStart == 0 {
		t.Fatal("newStart must be set")
	}
}
