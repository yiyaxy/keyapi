package types

import "fmt"

type GroupRatioInfo struct {
	GroupRatio        float64
	GroupSpecialRatio float64
	HasSpecialRatio   bool
}

type PriceData struct {
	FreeModel            bool
	ModelPrice           float64
	ModelRatio           float64
	OriginalModelRatio   float64
	CompletionRatio      float64
	CacheRatio           float64
	CacheCreationRatio   float64
	CacheCreation5mRatio float64
	CacheCreation1hRatio float64
	ImageRatio           float64
	AudioRatio           float64
	AudioCompletionRatio float64
	OtherRatios          map[string]float64
	UsePrice             bool
	Quota                int
	QuotaToPreConsume    int
	GroupRatioInfo       GroupRatioInfo

	PlatformCostQuota             int
	PlatformCostQuotaToPreConsume int
	PlatformCostModelRatio        float64
	PlatformCostModelPrice        float64
	PlatformCostChannelRatio      float64
	PlatformCostOtherRatios       map[string]float64
}

func (p *PriceData) AddOtherRatio(key string, ratio float64) {
	if p.OtherRatios == nil {
		p.OtherRatios = make(map[string]float64)
	}
	if ratio <= 0 {
		return
	}
	p.OtherRatios[key] = ratio
}

func (p *PriceData) AddPlatformCostOtherRatio(key string, ratio float64) {
	if ratio <= 0 {
		return
	}
	if p.PlatformCostOtherRatios == nil {
		p.PlatformCostOtherRatios = make(map[string]float64)
	}
	p.PlatformCostOtherRatios[key] = ratio
}

func (p *PriceData) ToSetting() string {
	return fmt.Sprintf(
		"ModelPrice: %f, ModelRatio: %f, CompletionRatio: %f, CacheRatio: %f, GroupRatio: %f, UsePrice: %t, CacheCreationRatio: %f, CacheCreation5mRatio: %f, CacheCreation1hRatio: %f, QuotaToPreConsume: %d, ImageRatio: %f, AudioRatio: %f, AudioCompletionRatio: %f, PlatformCostQuota: %d, PlatformCostQuotaToPreConsume: %d, PlatformCostModelRatio: %f, PlatformCostModelPrice: %f, PlatformCostChannelRatio: %f",
		p.ModelPrice, p.ModelRatio, p.CompletionRatio, p.CacheRatio, p.GroupRatioInfo.GroupRatio, p.UsePrice,
		p.CacheCreationRatio, p.CacheCreation5mRatio, p.CacheCreation1hRatio, p.QuotaToPreConsume,
		p.ImageRatio, p.AudioRatio, p.AudioCompletionRatio,
		p.PlatformCostQuota, p.PlatformCostQuotaToPreConsume, p.PlatformCostModelRatio, p.PlatformCostModelPrice, p.PlatformCostChannelRatio,
	)
}
