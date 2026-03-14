package service

import (
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func GetCallbackAddress() string {
	return system_setting.ServerAddress
}
