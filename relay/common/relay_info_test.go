package common

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestRelayInfoGetFinalRequestRelayFormatPrefersExplicitFinal(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		RequestConversionChain:  []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
		FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatOpenAIResponses), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToConversionChain(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:            types.RelayFormatOpenAI,
		RequestConversionChain: []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatClaude), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToRelayFormat(t *testing.T) {
	info := &RelayInfo{
		RelayFormat: types.RelayFormatGemini,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatGemini), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatNilReceiver(t *testing.T) {
	var info *RelayInfo
	require.Equal(t, types.RelayFormat(""), info.GetFinalRequestRelayFormat())
}

func TestRelayInfo_EffectiveDuration_NoWait(t *testing.T) {
	info := &RelayInfo{StartTime: time.Now().Add(-3 * time.Second)}
	got := info.EffectiveDuration()
	if got < 2*time.Second || got > 4*time.Second {
		t.Errorf("expected ~3s, got %v", got)
	}
}

func TestRelayInfo_EffectiveDuration_SubtractsWait(t *testing.T) {
	info := &RelayInfo{StartTime: time.Now().Add(-10 * time.Second)}
	info.AddImageToolWaitDuration(7 * time.Second)
	got := info.EffectiveDuration()
	// total ~10s, wait 7s → effective ~3s
	if got < 2500*time.Millisecond || got > 3500*time.Millisecond {
		t.Errorf("expected ~3s after subtracting 7s wait from ~10s total, got %v", got)
	}
}

func TestRelayInfo_EffectiveDuration_WaitExceedingTotalReturnsZero(t *testing.T) {
	// Defensive: clock skew or accounting bug must not produce a negative
	// duration that would underflow downstream summations.
	info := &RelayInfo{StartTime: time.Now().Add(-1 * time.Second)}
	info.AddImageToolWaitDuration(5 * time.Second)
	if got := info.EffectiveDuration(); got != 0 {
		t.Errorf("expected 0 when wait > total, got %v", got)
	}
}

func TestRelayInfo_AddImageToolWaitDuration_Accumulates(t *testing.T) {
	// Multiple in-process imagegen tool calls within one chat request all
	// add to the same accumulator.
	info := &RelayInfo{}
	info.AddImageToolWaitDuration(2 * time.Second)
	info.AddImageToolWaitDuration(3 * time.Second)
	if got := info.ImageToolWaitDuration(); got != 5*time.Second {
		t.Errorf("expected 5s accumulated, got %v", got)
	}
}

func TestRelayInfo_AddImageToolWaitDuration_NilSafe(t *testing.T) {
	var info *RelayInfo
	info.AddImageToolWaitDuration(1 * time.Second) // must not panic
	if got := info.ImageToolWaitDuration(); got != 0 {
		t.Errorf("expected 0 for nil receiver, got %v", got)
	}
	if got := info.EffectiveDuration(); got != 0 {
		t.Errorf("expected 0 for nil receiver, got %v", got)
	}
}
