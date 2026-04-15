package ticket_storage

import "github.com/QuantumNous/new-api/setting/config"

// TicketStorageSetting 工单附件存储配置（非敏感项）
//
// 注意：敏感凭证（access_key / secret_key）通过单独的管理接口写入 Option 表，且不会通过 options 接口返回。
type TicketStorageSetting struct {
	Endpoint             string `json:"endpoint"`
	Region               string `json:"region"`
	Bucket               string `json:"bucket"`
	ForcePathStyle       bool   `json:"force_path_style"`
	PresignExpireSeconds int    `json:"presign_expire_seconds"`
	MaxFileSizeMB        int    `json:"max_file_size_mb"`
	MaxFilesPerTicket    int    `json:"max_files_per_ticket"`
	AllowedMimePrefix    string `json:"allowed_mime_prefix"`
	Prefix               string `json:"prefix"`
}

var ticketStorageSetting = TicketStorageSetting{
	Endpoint:             "",
	Region:               "",
	Bucket:               "",
	ForcePathStyle:       false,
	PresignExpireSeconds: 900,
	MaxFileSizeMB:        5,
	MaxFilesPerTicket:    5,
	AllowedMimePrefix:    "image/",
	Prefix:               "tickets/tmp",
}

func init() {
	config.GlobalConfig.Register("ticket_storage", &ticketStorageSetting)
}

func GetTicketStorageSetting() *TicketStorageSetting {
	return &ticketStorageSetting
}
