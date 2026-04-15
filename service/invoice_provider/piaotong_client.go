package invoice_provider

import (
	"bytes"
	crand "crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type BlueInvoiceItem struct {
	TaxClassificationCode string `json:"taxClassificationCode"`
	Quantity              string `json:"quantity"`
	GoodsName             string `json:"goodsName"`
	UnitPrice             string `json:"unitPrice"`
	InvoiceAmount         string `json:"invoiceAmount"`
	TaxRateValue          string `json:"taxRateValue"`
	IncludeTaxFlag        string `json:"includeTaxFlag"`
}

// PaymentItem represents a payment info entry in the 支付宝乐企联用 paymentList.
type PaymentItem struct {
	PaymentCode       string `json:"paymentCode"`
	TransactionAmount string `json:"transactionAmount"`
	PaymentOrderNo    string `json:"paymentOrderNo"`
	TradeNo           string `json:"tradeNo"`
	SubMchid          string `json:"subMchid"`
	Account           string `json:"account"`
}

type PiaoTongResponse struct {
	Code       string                 `json:"code"`
	Msg        string                 `json:"msg"`
	SerialNo   string                 `json:"serialNo"`
	Content    map[string]interface{} `json:"content"`
	RawContent string                 `json:"rawContent"`
}

type piaoTongEnvelope struct {
	PlatformCode string `json:"platformCode"`
	SignType     string `json:"signType"`
	Sign         string `json:"sign"`
	Format       string `json:"format"`
	Timestamp    string `json:"timestamp"`
	Version      string `json:"version"`
	SerialNo     string `json:"serialNo"`
	Content      string `json:"content"`
}

type PiaoTongClient struct {
	baseURL                      string
	platformCode                 string
	platformAlias                string
	tripleDESKey                 string
	privateKey                   string
	publicKey                    string
	sellerTaxpayerNum            string
	sellerEnterpriseName         string
	defaultIssueKindCode         string
	defaultTaxClassificationCode string
	defaultGoodsName             string
	defaultTaxRateValue          string
	httpClient                   *http.Client
}

func NewPiaoTongClient() *PiaoTongClient {
	cfg := loadPiaoTongConfig()
	return &PiaoTongClient{
		baseURL:                      cfg["InvoicePiaoTongBaseURL"],
		platformCode:                 cfg["InvoicePiaoTongPlatformCode"],
		platformAlias:                cfg["InvoicePiaoTongPlatformAlias"],
		tripleDESKey:                 cfg["InvoicePiaoTong3DESKey"],
		privateKey:                   cfg["InvoicePiaoTongPrivateKey"],
		publicKey:                    cfg["InvoicePiaoTongPublicKey"],
		sellerTaxpayerNum:            cfg["InvoiceSellerTaxpayerNum"],
		sellerEnterpriseName:         cfg["InvoiceSellerEnterpriseName"],
		defaultIssueKindCode:         cfg["InvoiceDefaultIssueKindCode"],
		defaultTaxClassificationCode: cfg["InvoiceDefaultTaxClassificationCode"],
		defaultGoodsName:             cfg["InvoiceDefaultGoodsName"],
		defaultTaxRateValue:          cfg["InvoiceDefaultTaxRateValue"],
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func GenerateSerialNo() string {
	client := NewPiaoTongClient()
	serialNo, err := client.generateSerialNo()
	if err != nil {
		common.SysError("piaotong generate serial no failed: " + err.Error())
		return ""
	}
	return serialNo
}

func IssueBlueInvoice(taxpayerNum, invoiceReqSerialNo, buyerName, buyerTaxpayerNum, remark, invoiceIssueKindCode string, items []BlueInvoiceItem, invIssueChannel string, paymentList []PaymentItem) (*PiaoTongResponse, error) {
	return NewPiaoTongClient().IssueBlueInvoice(taxpayerNum, invoiceReqSerialNo, buyerName, buyerTaxpayerNum, remark, invoiceIssueKindCode, items, invIssueChannel, paymentList)
}

func QueryInvoiceMain(taxpayerNum, invoiceReqSerialNo string) (*PiaoTongResponse, error) {
	return NewPiaoTongClient().QueryInvoiceMain(taxpayerNum, invoiceReqSerialNo)
}

func QueryInvoiceFull(taxpayerNum, invoiceReqSerialNo string) (*PiaoTongResponse, error) {
	return NewPiaoTongClient().QueryInvoiceFull(taxpayerNum, invoiceReqSerialNo)
}

func GetInvoiceFile(taxpayerNum, invoiceReqSerialNo, fileType string) (*PiaoTongResponse, error) {
	return NewPiaoTongClient().GetInvoiceFile(taxpayerNum, invoiceReqSerialNo, fileType)
}

func loadPiaoTongConfig() map[string]string {
	keys := []string{
		"InvoicePiaoTongBaseURL",
		"InvoicePiaoTongPlatformCode",
		"InvoicePiaoTongPlatformAlias",
		"InvoicePiaoTong3DESKey",
		"InvoicePiaoTongPrivateKey",
		"InvoicePiaoTongPublicKey",
		"InvoiceSellerTaxpayerNum",
		"InvoiceSellerEnterpriseName",
		"InvoiceDefaultIssueKindCode",
		"InvoiceDefaultTaxClassificationCode",
		"InvoiceDefaultGoodsName",
		"InvoiceDefaultTaxRateValue",
	}
	cfg := make(map[string]string, len(keys))
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	for _, key := range keys {
		cfg[key] = strings.TrimSpace(common.OptionMap[key])
	}
	return cfg
}

func (c *PiaoTongClient) IssueBlueInvoice(taxpayerNum, invoiceReqSerialNo, buyerName, buyerTaxpayerNum, remark, invoiceIssueKindCode string, items []BlueInvoiceItem, invIssueChannel string, paymentList []PaymentItem) (*PiaoTongResponse, error) {
	issueKindCode := strings.TrimSpace(invoiceIssueKindCode)
	if issueKindCode == "" {
		issueKindCode = c.defaultIssueKindCode
	}
	payload := map[string]interface{}{
		"taxpayerNum":          firstNonEmpty(taxpayerNum, c.sellerTaxpayerNum),
		"invoiceReqSerialNo":   strings.TrimSpace(invoiceReqSerialNo),
		"buyerName":            strings.TrimSpace(buyerName),
		"buyerTaxpayerNum":     strings.TrimSpace(buyerTaxpayerNum),
		"remark":               strings.TrimSpace(remark),
		"invoiceIssueKindCode": issueKindCode,
		"itemList":             c.normalizeBlueInvoiceItems(items),
	}
	if invIssueChannel == "5" && len(paymentList) > 0 {
		payload["invIssueChannel"] = "5"
		payload["paymentList"] = paymentList
	}
	return c.doRequest("/tp/openapi/invoiceBlue.pt", payload)
}

func (c *PiaoTongClient) QueryInvoiceMain(taxpayerNum, invoiceReqSerialNo string) (*PiaoTongResponse, error) {
	payload := map[string]interface{}{
		"taxpayerNum":        firstNonEmpty(taxpayerNum, c.sellerTaxpayerNum),
		"invoiceReqSerialNo": strings.TrimSpace(invoiceReqSerialNo),
	}
	return c.doRequest("/tp/openapi/queryInvoice.pt", payload)
}

func (c *PiaoTongClient) QueryInvoiceFull(taxpayerNum, invoiceReqSerialNo string) (*PiaoTongResponse, error) {
	payload := map[string]interface{}{
		"taxpayerNum":        firstNonEmpty(taxpayerNum, c.sellerTaxpayerNum),
		"invoiceReqSerialNo": strings.TrimSpace(invoiceReqSerialNo),
	}
	return c.doRequest("/tp/openapi/queryInvoiceInfo.pt", payload)
}

func (c *PiaoTongClient) GetInvoiceFile(taxpayerNum, invoiceReqSerialNo, fileType string) (*PiaoTongResponse, error) {
	payload := map[string]interface{}{
		"taxpayerNum":        firstNonEmpty(taxpayerNum, c.sellerTaxpayerNum),
		"invoiceReqSerialNo": strings.TrimSpace(invoiceReqSerialNo),
		"fileType":           strings.TrimSpace(fileType),
	}
	return c.doRequest("/tp/openapi/getAllEleInvFile.pt", payload)
}

func (c *PiaoTongClient) normalizeBlueInvoiceItems(items []BlueInvoiceItem) []map[string]string {
	result := make([]map[string]string, 0, len(items))
	for _, item := range items {
		result = append(result, map[string]string{
			"taxClassificationCode": firstNonEmpty(strings.TrimSpace(item.TaxClassificationCode), c.defaultTaxClassificationCode),
			"quantity":              strings.TrimSpace(item.Quantity),
			"goodsName":             firstNonEmpty(strings.TrimSpace(item.GoodsName), c.defaultGoodsName),
			"unitPrice":             strings.TrimSpace(item.UnitPrice),
			"invoiceAmount":         strings.TrimSpace(item.InvoiceAmount),
			"taxRateValue":          firstNonEmpty(strings.TrimSpace(item.TaxRateValue), c.defaultTaxRateValue),
			"includeTaxFlag":        firstNonEmpty(strings.TrimSpace(item.IncludeTaxFlag), "0"),
		})
	}
	return result
}

func (c *PiaoTongClient) doRequest(endpoint string, contentPayload interface{}) (*PiaoTongResponse, error) {
	if err := c.validateConfig(); err != nil {
		common.SysError("piaotong config validation failed: " + err.Error())
		return nil, err
	}
	contentJSON, err := json.Marshal(contentPayload)
	if err != nil {
		common.SysError("piaotong marshal content failed: " + err.Error())
		return nil, err
	}
	encryptedContent, err := TripleDESEncryptECBBase64(string(contentJSON), c.tripleDESKey)
	if err != nil {
		common.SysError("piaotong encrypt content failed: " + err.Error())
		return nil, err
	}
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	serialNo, err := c.generateSerialNo()
	if err != nil {
		common.SysError("piaotong generate serial no failed: " + err.Error())
		return nil, err
	}
	signParams := map[string]string{
		"content":      encryptedContent,
		"format":       "JSON",
		"platformCode": c.platformCode,
		"serialNo":     serialNo,
		"signType":     "RSA",
		"timestamp":    timestamp,
		"version":      "1.0",
	}
	signString := BuildPiaoTongSignString(signParams)
	signature, err := RSASignSHA1Base64(signString, c.privateKey)
	if err != nil {
		common.SysError("piaotong sign failed: " + err.Error())
		return nil, err
	}
	envelope := piaoTongEnvelope{
		PlatformCode: c.platformCode,
		SignType:     "RSA",
		Sign:         signature,
		Format:       "JSON",
		Timestamp:    timestamp,
		Version:      "1.0",
		SerialNo:     serialNo,
		Content:      encryptedContent,
	}
	bodyBytes, err := json.Marshal(envelope)
	if err != nil {
		common.SysError("piaotong marshal envelope failed: " + err.Error())
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(c.baseURL, "/")+endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		common.SysError("piaotong build request failed: " + err.Error())
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := c.httpClient.Do(request)
	if err != nil {
		common.SysError("piaotong request failed: " + err.Error())
		return nil, err
	}
	defer response.Body.Close()
	respBody, err := io.ReadAll(response.Body)
	if err != nil {
		common.SysError("piaotong read response failed: " + err.Error())
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		err = fmt.Errorf("piaotong http status %d: %s", response.StatusCode, strings.TrimSpace(string(respBody)))
		common.SysError(err.Error())
		return nil, err
	}
	return c.parseResponse(respBody)
}

func (c *PiaoTongClient) parseResponse(respBody []byte) (*PiaoTongResponse, error) {
	var envelope map[string]interface{}
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		common.SysError("piaotong unmarshal response failed: " + err.Error())
		return nil, err
	}
	response := &PiaoTongResponse{
		Code:     stringValue(envelope["code"]),
		Msg:      stringValue(envelope["msg"]),
		SerialNo: stringValue(envelope["serialNo"]),
		Content:  map[string]interface{}{},
	}
	encryptedContent := stringValue(envelope["content"])
	response.RawContent = encryptedContent
	signature := stringValue(envelope["sign"])
	signParams := map[string]string{}
	for key, value := range envelope {
		if key == "sign" || value == nil {
			continue
		}
		signParams[key] = stringValue(value)
	}
	if signature != "" {
		signString := BuildPiaoTongSignString(signParams)
		if err := RSAVerifySHA1Base64(signString, signature, c.publicKey); err != nil {
			common.SysError("piaotong verify response signature failed: " + err.Error())
			return nil, err
		}
	}
	if encryptedContent == "" {
		return response, nil
	}
	decryptedContent, err := TripleDESDecryptECBBase64(encryptedContent, c.tripleDESKey)
	if err != nil {
		common.SysError("piaotong decrypt response content failed: " + err.Error())
		return nil, err
	}
	response.RawContent = decryptedContent
	if strings.TrimSpace(decryptedContent) == "" {
		return response, nil
	}
	if err := json.Unmarshal([]byte(decryptedContent), &response.Content); err != nil {
		common.SysError("piaotong unmarshal decrypted content failed: " + err.Error())
		return nil, err
	}
	return response, nil
}

func (c *PiaoTongClient) validateConfig() error {
	if strings.TrimSpace(c.baseURL) == "" {
		return fmt.Errorf("missing InvoicePiaoTongBaseURL")
	}
	if strings.TrimSpace(c.platformCode) == "" {
		return fmt.Errorf("missing InvoicePiaoTongPlatformCode")
	}
	if strings.TrimSpace(c.platformAlias) == "" {
		return fmt.Errorf("missing InvoicePiaoTongPlatformAlias")
	}
	if strings.TrimSpace(c.tripleDESKey) == "" {
		return fmt.Errorf("missing InvoicePiaoTong3DESKey")
	}
	if strings.TrimSpace(c.privateKey) == "" {
		return fmt.Errorf("missing InvoicePiaoTongPrivateKey")
	}
	if strings.TrimSpace(c.publicKey) == "" {
		return fmt.Errorf("missing InvoicePiaoTongPublicKey")
	}
	return nil
}

func (c *PiaoTongClient) generateSerialNo() (string, error) {
	// PiaoTong requires exactly 20 characters: prefix + yyyyMMddHHmmss + random digits
	prefix := c.platformAlias
	ts := time.Now().Format("20060102150405") // 14 chars
	remaining := 20 - len(prefix) - len(ts)
	if remaining < 0 {
		remaining = 0
	}
	if remaining == 0 {
		// Truncate prefix if needed to fit 20 chars
		maxPrefix := 20 - len(ts)
		if maxPrefix < 0 {
			maxPrefix = 0
		}
		if len(prefix) > maxPrefix {
			prefix = prefix[:maxPrefix]
		}
		return prefix + ts, nil
	}
	randDigits, err := randomDigits(remaining)
	if err != nil {
		return "", err
	}
	return prefix + ts + randDigits, nil
}

func randomDigits(length int) (string, error) {
	if length <= 0 {
		return "", fmt.Errorf("invalid random digit length")
	}
	buf := make([]byte, length)
	for i := 0; i < length; i++ {
		n, err := crand.Int(crand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		buf[i] = byte('0' + n.Int64())
	}
	return string(buf), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func stringValue(v interface{}) string {
	switch value := v.(type) {
	case string:
		return strings.TrimSpace(value)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}

// RedInvoice calls PiaoTong API 2.10 invoiceRed.pt to void/red an issued invoice.
func RedInvoice(taxpayerNum, invoiceReqSerialNo, invoiceCode, invoiceNo, blueAllEleInvNo, amount, redReason string) (*PiaoTongResponse, error) {
	return NewPiaoTongClient().RedInvoice(taxpayerNum, invoiceReqSerialNo, invoiceCode, invoiceNo, blueAllEleInvNo, amount, redReason)
}

func (c *PiaoTongClient) RedInvoice(taxpayerNum, invoiceReqSerialNo, invoiceCode, invoiceNo, blueAllEleInvNo, amount, redReason string) (*PiaoTongResponse, error) {
	content := map[string]interface{}{
		"taxpayerNum":        taxpayerNum,
		"invoiceReqSerialNo": invoiceReqSerialNo,
		"amount":             amount,
		"redReason":          redReason,
	}
	if strings.TrimSpace(invoiceCode) != "" || strings.TrimSpace(invoiceNo) != "" {
		content["invoiceCode"] = invoiceCode
		content["invoiceNo"] = invoiceNo
	}
	if strings.TrimSpace(blueAllEleInvNo) != "" {
		content["blueAllEleInvNo"] = blueAllEleInvNo
	}
	return c.doRequest("/tp/openapi/invoiceRed.pt", content)
}
