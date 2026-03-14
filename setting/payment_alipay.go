package setting

import (
	"log"

	"github.com/QuantumNous/new-api/common"
)

var AlipayAppId = ""
var AlipayPrivateKey = "" // 应用私钥 RSA2
var AlipayPublicKey = ""  // 支付宝公钥
var AlipaySandbox = false // 沙箱模式

func InitAlipaySettings() {
	AlipayAppId = common.GetEnvOrDefaultString("ALIPAY_APP_ID", "")
	AlipayPrivateKey = common.GetEnvOrDefaultString("ALIPAY_PRIVATE_KEY", "")
	AlipayPublicKey = common.GetEnvOrDefaultString("ALIPAY_PUBLIC_KEY", "")
	AlipaySandbox = common.GetEnvOrDefaultBool("ALIPAY_SANDBOX", false)
	log.Printf("[Alipay] AppId=%q PrivateKey=%d chars PublicKey=%d chars Sandbox=%v",
		AlipayAppId, len(AlipayPrivateKey), len(AlipayPublicKey), AlipaySandbox)
}
