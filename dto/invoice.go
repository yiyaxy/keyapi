package dto

// InvoiceableOrdersSelfQuery is used by GET /api/invoice/self/invoiceable_orders
// via query params.
type InvoiceableOrdersSelfQuery struct {
	Keyword  string `form:"keyword" json:"keyword"`
	Page     int    `form:"page" json:"page"`
	PageSize int    `form:"page_size" json:"page_size"`
}

// InvoiceApplicationCreateRequest is used by POST /api/invoice/self/applications.
type InvoiceApplicationCreateRequest struct {
	InvoiceType           string                              `json:"invoice_type"`
	Title                 string                              `json:"title"`
	TaxId                 string                              `json:"tax_id"`
	Email                 string                              `json:"email"`
	ApplyRemark           string                              `json:"apply_remark"`
	GoodsName             string                              `json:"goods_name"`
	TaxClassificationCode string                              `json:"tax_classification_code"`
	TaxRateValue          string                              `json:"tax_rate_value"`
	IssueKindCode         string                              `json:"issue_kind_code"`
	Items                 []InvoiceApplicationCreateItemInput `json:"items"`
}

type InvoiceApplicationCreateItemInput struct {
	SourceType string `json:"source_type"`
	SourceId   int    `json:"source_id"`
}

// InvoiceAdminPresignUploadRequest is used by POST /api/invoice/admin/uploads/presign.
type InvoiceAdminPresignUploadRequest struct {
	InvoiceId   int    `json:"invoice_id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

// InvoiceAdminFinalizeFilesRequest is used by POST /api/invoice/admin/applications/:id/files.
type InvoiceAdminFinalizeFilesRequest struct {
	ObjectKeys []string `json:"object_keys"`
}

// InvoiceAdminUpdateFileVisibilityRequest is used by POST /api/invoice/admin/applications/:id/files/:file_id/visibility.
type InvoiceAdminUpdateFileVisibilityRequest struct {
	IsUserVisible bool `json:"is_user_visible"`
}

// InvoicePresignFileResponse is used by GET /api/invoice/*/files/:file_id/presign.
type InvoicePresignFileResponse struct {
	URL              string `json:"url"`
	ExpiresAtUnixSec int64  `json:"expires_at"`
}

// InvoiceAdminUpdateStatusRequest is used by POST /api/invoice/admin/applications/:id/status.
type InvoiceAdminUpdateStatusRequest struct {
	Status                string `json:"status"`
	AdminRemark           string `json:"admin_remark"`
	RejectReason          string `json:"reject_reason"`
	GoodsName             string `json:"goods_name"`
	TaxClassificationCode string `json:"tax_classification_code"`
	TaxRateValue          string `json:"tax_rate_value"`
}

type InvoiceAdminIssueRequest struct {
	ForceAuto bool `json:"force_auto"`
}

// InvoiceApplicationListItem is a lightweight list item for both user and admin list endpoints.
type InvoiceApplicationListItem struct {
	Id                         int     `json:"id"`
	UserId                     int     `json:"user_id"`
	InvoiceType                string  `json:"invoice_type"`
	Title                      string  `json:"title"`
	TaxId                      string  `json:"tax_id"`
	Email                      string  `json:"email"`
	Status                     string  `json:"status"`
	IssueStatus                string  `json:"issue_status"`
	Provider                   string  `json:"provider"`
	IssueMode                  string  `json:"issue_mode"`
	TotalMoney                 float64 `json:"total_money"`
	Currency                   string  `json:"currency"`
	ApplyRemark                string  `json:"apply_remark"`
	AdminRemark                string  `json:"admin_remark"`
	RejectReason               string  `json:"reject_reason"`
	GoodsName                  string  `json:"goods_name"`
	TaxClassificationCode      string  `json:"tax_classification_code"`
	TaxRateValue               string  `json:"tax_rate_value"`
	IssueKindCode              string  `json:"issue_kind_code"`
	PiaoTongSerialNo           string  `json:"piaotong_serial_no"`
	PiaoTongInvoiceReqSerialNo string  `json:"piaotong_invoice_req_serial_no"`
	PiaoTongInvoiceCode        string  `json:"piaotong_invoice_code"`
	PiaoTongInvoiceNo          string  `json:"piaotong_invoice_no"`
	PiaoTongBlueAllEleInvNo    string  `json:"piaotong_blue_all_ele_inv_no"`
	PiaoTongInvoiceStatus      string  `json:"piaotong_invoice_status"`
	PiaoTongAuthId             string  `json:"piaotong_auth_id"`
	IssueAttempts              int     `json:"issue_attempts"`
	QueryAttempts              int     `json:"query_attempts"`
	LastIssueAttemptAt         int64   `json:"last_issue_attempt_at"`
	LastQueryAt                int64   `json:"last_query_at"`
	NextQueryAt                int64   `json:"next_query_at"`
	IssueErrorCode             string  `json:"issue_error_code"`
	IssueErrorMessage          string  `json:"issue_error_message"`
	FileFetchStatus            string  `json:"file_fetch_status"`
	FileFetchedAt              int64   `json:"file_fetched_at"`
	RedStatus                  string  `json:"red_status"`
	RedReason                  string  `json:"red_reason"`
	RedErrorMessage            string  `json:"red_error_message"`
	RedAt                      int64   `json:"red_at"`
	CreatedAt                  int64   `json:"created_at"`
	UpdatedAt                  int64   `json:"updated_at"`
	ApprovedAt                 int64   `json:"approved_at"`
	IssuedAt                   int64   `json:"issued_at"`
	CancelledAt                int64   `json:"cancelled_at"`
	Username                   string  `json:"username"`
}

// InvoiceApplicationDetailResponse is the full detail response for a single application.
type InvoiceApplicationDetailResponse struct {
	Application InvoiceApplicationListItem     `json:"application"`
	Items       []InvoiceApplicationDetailItem `json:"items"`
	Files       []InvoiceApplicationDetailFile `json:"files"`
}

// InvoiceApplicationDetailItem represents an item within an invoice application detail.
type InvoiceApplicationDetailItem struct {
	Id            int     `json:"id"`
	SourceType    string  `json:"source_type"`
	SourceId      int     `json:"source_id"`
	TradeNo       string  `json:"trade_no"`
	Money         float64 `json:"money"`
	Currency      string  `json:"currency"`
	PaymentMethod string  `json:"payment_method"`
	CompleteTime  int64   `json:"complete_time"`
	// 支付宝乐企联用支付信息
	PaymentCode       string `json:"payment_code"`
	TradeNoThirdParty string `json:"trade_no_third_party"`
	SubMchid          string `json:"sub_mchid"`
	Account           string `json:"account"`
}

// InvoiceApplicationDetailFile represents a file attached to an invoice application.
type InvoiceApplicationDetailFile struct {
	Id               int    `json:"id"`
	OriginalFilename string `json:"original_filename"`
	ContentType      string `json:"content_type"`
	SizeBytes        int64  `json:"size_bytes"`
	FileKind         string `json:"file_kind"`
	Source           string `json:"source"`
	IsRed            bool   `json:"is_red"`
	IsUserVisible    bool   `json:"is_user_visible"`
	CreatedAt        int64  `json:"created_at"`
}

// InvoiceRedRequest is used by POST /api/invoice/admin/applications/:id/red.
type InvoiceRedRequest struct {
	RedReason string `json:"red_reason"`
}

// InvoiceAdminSetItemPaymentInfoRequest is used by POST /api/invoice/admin/applications/:id/items/:item_id/payment_info.
type InvoiceAdminSetItemPaymentInfoRequest struct {
	PaymentCode       string `json:"payment_code"`
	TradeNoThirdParty string `json:"trade_no_third_party"`
	SubMchid          string `json:"sub_mchid"`
	Account           string `json:"account"`
}
