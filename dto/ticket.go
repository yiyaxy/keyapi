package dto

// TicketPresignUploadRequest is used by POST /api/ticket/uploads/presign
// to request a presigned upload URL.
type TicketPresignUploadRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

type TicketPresignUploadResponse struct {
	ObjectKey        string            `json:"object_key"`
	UploadURL        string            `json:"upload_url"`
	RequiredHeaders  map[string]string `json:"required_headers"`
	ExpiresAtUnixSec int64             `json:"expires_at"`
}

// TicketCreateRequest is used by POST /api/ticket
// object_keys are previously uploaded OSS object keys.
type TicketCreateRequest struct {
	Subject    string   `json:"subject"`
	Content    string   `json:"content"`
	ObjectKeys []string `json:"object_keys"`
}

// TicketReplyRequest is used by POST /api/ticket/:id/reply
// object_keys are previously uploaded OSS object keys.
type TicketReplyRequest struct {
	Content    string   `json:"content"`
	ObjectKeys []string `json:"object_keys"`
}

// TicketUpdateStatusRequest is used by POST /api/ticket/admin/:id/status
type TicketUpdateStatusRequest struct {
	Status string `json:"status"`
}

type TicketPresignAttachmentResponse struct {
	URL             string `json:"url"`
	ExpiresAtUnixSec int64  `json:"expires_at"`
}
