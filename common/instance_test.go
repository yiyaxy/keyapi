package common

import (
	"testing"

	"github.com/google/uuid"
)

func TestInitInstanceID_GeneratesValidUUID(t *testing.T) {
	InstanceID = ""
	InitInstanceID()
	if InstanceID == "" {
		t.Fatal("InstanceID should be non-empty after InitInstanceID")
	}
	if _, err := uuid.Parse(InstanceID); err != nil {
		t.Fatalf("InstanceID should be a valid UUID, got %q: %v", InstanceID, err)
	}
}

func TestInitInstanceID_Idempotent(t *testing.T) {
	InstanceID = ""
	InitInstanceID()
	first := InstanceID
	InitInstanceID()
	if InstanceID != first {
		t.Fatalf("InitInstanceID should be idempotent, got %q then %q", first, InstanceID)
	}
}
