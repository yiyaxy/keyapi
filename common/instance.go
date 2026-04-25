package common

import "github.com/google/uuid"

// InstanceID is the per-process UUID used to distinguish
// pub/sub broadcasts originating from this instance vs. peers.
// Set once at startup by InitInstanceID; never mutated afterwards.
var InstanceID string

func InitInstanceID() {
	if InstanceID != "" {
		return
	}
	InstanceID = uuid.NewString()
	SysLog("instance id: " + InstanceID)
}
