package syncwrap

import (
	"time"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
)

type SyncWrapSnapshot struct {
	TaskPublicID string
	TaskID       int64
	RequestID    string

	ChannelMeta relaycommon.ChannelMeta
	Proxy       string

	OriginModelName   string
	UpstreamModelName string
	ImageRequest      dto.ImageRequest

	UserID   int
	TenantID int
	TokenID  int

	Quota             int
	PriceData         types.PriceData
	PriceMarkupRatio  float64
	PriceMarkupSource string
}

func (s *SyncWrapSnapshot) ToRelayInfo() *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{
		TenantId:          s.TenantID,
		TokenId:           s.TokenID,
		UserId:            s.UserID,
		StartTime:         time.Now(),
		RelayMode:         relayconstant.RelayModeImagesGenerations,
		RelayFormat:       types.RelayFormatOpenAIImage,
		RequestURLPath:    "/v1/images/generations",
		OriginModelName:   s.OriginModelName,
		RequestId:         s.RequestID,
		PriceData:         s.PriceData,
		PriceMarkupRatio:  s.PriceMarkupRatio,
		PriceMarkupSource: s.PriceMarkupSource,
		Request:           &s.ImageRequest,
	}
	meta := s.ChannelMeta
	meta.UpstreamModelName = s.UpstreamModelName
	info.ChannelMeta = &meta
	return info
}
