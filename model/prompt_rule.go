package model

import (
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

const (
	PromptRuleTypeReplace  = 1 // 整条替换
	PromptRuleTypeKeyword  = 2 // 关键词替换
	PromptRuleTypeResponse = 3 // 回复替换
	PromptRuleTypeRewrite  = 4 // AI改写
)

type PromptRule struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string `json:"name" gorm:"type:varchar(100)"`
	Type        int    `json:"type" gorm:"default:1"`
	Keyword     string `json:"keyword" gorm:"type:text"`
	Replacement string `json:"replacement" gorm:"type:text"`
	ChannelId   int    `json:"channel_id" gorm:"default:0;index"`
	Enabled     bool   `json:"enabled" gorm:"default:true"`
	Priority         int    `json:"priority" gorm:"default:0"`
	RewriteChannelId int    `json:"rewrite_channel_id" gorm:"default:0"`
	RewriteModel     string `json:"rewrite_model" gorm:"type:varchar(100)"`
	CreatedAt        int64  `json:"created_at" gorm:"autoCreateTime"`
}

var (
	promptRuleCache     []PromptRule
	promptRuleCacheLock sync.RWMutex
)

func LoadPromptRuleCache() {
	var rules []PromptRule
	DB.Where("enabled = ?", true).Order("priority DESC").Find(&rules)
	promptRuleCacheLock.Lock()
	promptRuleCache = rules
	promptRuleCacheLock.Unlock()
}

func GetCachedPromptRules() []PromptRule {
	promptRuleCacheLock.RLock()
	defer promptRuleCacheLock.RUnlock()
	result := make([]PromptRule, len(promptRuleCache))
	copy(result, promptRuleCache)
	return result
}

func GetAllPromptRules(page *common.PageInfo, keyword string) ([]PromptRule, int64, error) {
	var rules []PromptRule
	var total int64
	tx := DB.Model(&PromptRule{})
	if keyword != "" {
		tx = tx.Where("name LIKE ? OR keyword LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := tx.Order("priority DESC, id DESC").
		Offset(page.GetStartIdx()).
		Limit(page.GetPageSize()).
		Find(&rules).Error
	return rules, total, err
}

func CreatePromptRule(rule *PromptRule) error {
	err := DB.Create(rule).Error
	if err == nil {
		LoadPromptRuleCache()
	}
	return err
}

func UpdatePromptRule(rule *PromptRule) error {
	err := DB.Save(rule).Error
	if err == nil {
		LoadPromptRuleCache()
	}
	return err
}

func DeletePromptRule(id int) error {
	err := DB.Delete(&PromptRule{}, id).Error
	if err == nil {
		LoadPromptRuleCache()
	}
	return err
}

// HasResponseRulesForChannel checks if there are any response replacement rules for a channel.
func HasResponseRulesForChannel(channelId int) bool {
	rules := GetPromptRulesForChannel(channelId)
	for _, rule := range rules {
		if rule.Type == PromptRuleTypeResponse {
			return true
		}
	}
	return false
}

// HasRewriteRulesForChannel checks if there are any AI rewrite rules for a channel.
func HasRewriteRulesForChannel(channelId int) bool {
	rules := GetPromptRulesForChannel(channelId)
	for _, rule := range rules {
		if rule.Type == PromptRuleTypeRewrite {
			return true
		}
	}
	return false
}

// GetPromptRulesForChannel returns rules applicable to a channel, sorted by priority DESC.
// Channel-specific rules override global rules with the same keyword.
func GetPromptRulesForChannel(channelId int) []PromptRule {
	all := GetCachedPromptRules()
	var result []PromptRule
	seen := make(map[string]bool) // keyword -> has channel-specific rule

	// Sort: channel-specific first, then global
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].ChannelId != all[j].ChannelId {
			return all[i].ChannelId > 0 && all[j].ChannelId == 0
		}
		return all[i].Priority > all[j].Priority
	})

	for _, rule := range all {
		if rule.ChannelId != 0 && rule.ChannelId != channelId {
			continue
		}
		keywords := strings.Split(rule.Keyword, "\n")
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw == "" {
				continue
			}
			key := kw + "|" + string(rune(rule.Type))
			if rule.ChannelId > 0 {
				seen[key] = true
			}
		}
		if rule.ChannelId == 0 {
			// Check if any keyword is overridden by channel rule
			hasOverride := false
			for _, kw := range keywords {
				kw = strings.TrimSpace(kw)
				if kw == "" {
					continue
				}
				key := kw + "|" + string(rune(rule.Type))
				if seen[key] {
					hasOverride = true
					break
				}
			}
			if hasOverride {
				continue
			}
		}
		result = append(result, rule)
	}
	return result
}
