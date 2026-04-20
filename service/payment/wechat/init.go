package wechat

import "github.com/QuantumNous/new-api/service/payment"

func init() {
	payment.Register(providerImpl{})
}
