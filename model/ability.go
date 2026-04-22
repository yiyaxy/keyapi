package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Ability struct {
	Group     string  `json:"group" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Model     string  `json:"model" gorm:"type:varchar(255);primaryKey;autoIncrement:false"`
	ChannelId int     `json:"channel_id" gorm:"primaryKey;autoIncrement:false;index"`
	// 对称 Channel.TenantId：tenant_id=0 是平台 ability 合法业务值。
	// 当前写入走 createAbilityRows 的 map-based 路径（tag 不生效），
	// default:0 主要是保证 AutoMigrate 生成的 DDL 默认值语义一致。
	TenantId  int     `json:"tenant_id" gorm:"index;not null;default:0"`
	Enabled   bool    `json:"enabled"`
	Priority  *int64  `json:"priority" gorm:"bigint;default:0;index"`
	Weight    uint    `json:"weight" gorm:"default:0;index"`
	Tag       *string `json:"tag" gorm:"index"`
	Scope     string  `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"`
}

type AbilityWithChannel struct {
	Ability
	ChannelType int `json:"channel_type"`
}

func GetAllEnableAbilityWithChannels(tenantId int) ([]AbilityWithChannel, error) {
	var abilities []AbilityWithChannel
	q := DB.Table("abilities").
		Select("abilities.*, channels.type as channel_type").
		Joins("left join channels on abilities.channel_id = channels.id").
		Where("abilities.enabled = ?", true)
	if tenantId > 0 {
		q = q.Where("abilities.tenant_id = ?", tenantId)
	}
	err := q.Scan(&abilities).Error
	return abilities, err
}

func GetGroupEnabledModels(group string, tenantId int) []string {
	var models []string
	q := DB.Table("abilities").Where(commonGroupCol+" = ? and enabled = ?", group, true)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)
	}
	q.Distinct("model").Pluck("model", &models)
	return models
}

func GetEnabledModels(tenantId int) []string {
	var models []string
	q := DB.Table("abilities").Where("enabled = ?", true)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", ChannelScopePlatform, tenantId)
	}
	q.Distinct("model").Pluck("model", &models)
	return models
}

func GetAllEnableAbilities(tenantId int) []Ability {
	var abilities []Ability
	q := DB.Where("enabled = ?", true)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	q.Find(&abilities)
	return abilities
}

// FixTenantAbilities rebuilds abilities for one tenant's own channels only.
func FixTenantAbilities(tenantId int) (success, fails int, err error) {
	if tenantId <= 0 {
		return 0, 0, errors.New("tenantId required")
	}
	if err := DB.Where("tenant_id = ? AND scope = ?", tenantId, ChannelScopeTenant).Delete(&Ability{}).Error; err != nil {
		return 0, 0, err
	}
	var channels []*Channel
	if err := DB.Where("tenant_id = ? AND scope = ?", tenantId, ChannelScopeTenant).Find(&channels).Error; err != nil {
		return 0, 0, err
	}
	for _, ch := range channels {
		if e := ch.AddAbilities(nil); e != nil {
			fails++
		} else {
			success++
		}
	}
	InitChannelCache()
	return success, fails, nil
}

func getPriority(group string, model string, retry int, tenantId int) (int, error) {

	var priorities []int
	q := DB.Model(&Ability{}).
		Select("DISTINCT(priority)").
		Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, model, true)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	err := q.Order("priority DESC"). // 按优先级降序排序
						Pluck("priority", &priorities).Error // Pluck用于将查询的结果直接扫描到一个切片中

	if err != nil {
		// 处理错误
		return 0, err
	}

	if len(priorities) == 0 {
		// 如果没有查询到优先级，则返回错误
		return 0, errors.New("数据库一致性被破坏")
	}

	// 确定要使用的优先级
	var priorityToUse int
	if retry >= len(priorities) {
		// 如果重试次数大于优先级数，则使用最小的优先级
		priorityToUse = priorities[len(priorities)-1]
	} else {
		priorityToUse = priorities[retry]
	}
	return priorityToUse, nil
}

func getChannelQuery(group string, model string, retry int, tenantId int) (*gorm.DB, error) {
	baseQ := func() *gorm.DB {
		q := DB.Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, model, true)
		if tenantId > 0 {
			q = q.Where("tenant_id = ?", tenantId)
		}
		return q
	}

	if retry != 0 {
		priority, err := getPriority(group, model, retry, tenantId)
		if err != nil {
			return nil, err
		}
		return baseQ().Where("priority = ?", priority), nil
	}

	maxPrioritySubQuery := DB.Model(&Ability{}).Select("MAX(priority)").Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, model, true)
	if tenantId > 0 {
		maxPrioritySubQuery = maxPrioritySubQuery.Where("tenant_id = ?", tenantId)
	}
	return baseQ().Where("priority = (?)", maxPrioritySubQuery), nil
}

func GetChannel(group string, model string, retry int, tenantId ...int) (*Channel, error) {
	var abilities []Ability
	tid := 0
	if len(tenantId) > 0 {
		tid = tenantId[0]
	}

	var err error = nil
	channelQuery, err := getChannelQuery(group, model, retry, tid)
	if err != nil {
		return nil, err
	}
	if common.UsingSQLite || common.UsingPostgreSQL {
		err = channelQuery.Order("weight DESC").Find(&abilities).Error
	} else {
		err = channelQuery.Order("weight DESC").Find(&abilities).Error
	}
	if err != nil {
		return nil, err
	}
	channel := Channel{}
	if len(abilities) > 0 {
		// Randomly choose one
		weightSum := uint(0)
		for _, ability_ := range abilities {
			weightSum += ability_.Weight + 10
		}
		// Randomly choose one
		weight := common.GetRandomInt(int(weightSum))
		for _, ability_ := range abilities {
			weight -= int(ability_.Weight) + 10
			//log.Printf("weight: %d, ability weight: %d", weight, *ability_.Weight)
			if weight <= 0 {
				channel.Id = ability_.ChannelId
				break
			}
		}
	} else {
		return nil, nil
	}
	err = DB.First(&channel, "id = ?", channel.Id).Error
	return &channel, err
}

func (channel *Channel) AddAbilities(tx *gorm.DB) error {
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				TenantId:  channel.TenantId,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
				Scope:     channel.Scope,
			}
			abilities = append(abilities, ability)
		}
	}
	if len(abilities) == 0 {
		return nil
	}
	// choose DB or provided tx
	useDB := DB
	if tx != nil {
		useDB = tx
	}
	if channel.Scope == ChannelScopePlatform || channel.TenantId == 0 {
		useDB = WithTenantBypass(useDB)
	}
	return createAbilityRows(useDB, abilities)
}

func createAbilityRows(db *gorm.DB, abilities []Ability) error {
	rows := make([]map[string]interface{}, 0, len(abilities))
	for _, ability := range abilities {
		// 平台渠道的 ability 必须 tenant_id=0，避免被缓存按 tenant 前缀分桶 /
		// 被守门员按租户列过滤。调用方即便传进来一个继承自 channel 的非 0 值
		// （历史脏数据、未走 AddChannel 归零路径），这里统一收口。
		tenantId := ability.TenantId
		if ability.Scope == ChannelScopePlatform {
			tenantId = 0
		}
		rows = append(rows, map[string]interface{}{
			"group":      ability.Group,
			"model":      ability.Model,
			"channel_id": ability.ChannelId,
			"tenant_id":  tenantId,
			"enabled":    ability.Enabled,
			"priority":   ability.Priority,
			"weight":     ability.Weight,
			"tag":        ability.Tag,
			"scope":      ability.Scope,
		})
	}
	for _, chunk := range lo.Chunk(rows, 50) {
		err := db.Model(&Ability{}).Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func (channel *Channel) DeleteAbilities() error {
	if channel.Id == 0 {
		return errors.New("channel.Id 不能为空")
	}
	return WithTenantBypass(DB).Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
}

// UpdateAbilities updates abilities of this channel.
// Make sure the channel is completed before calling this function.
func (channel *Channel) UpdateAbilities(tx *gorm.DB) error {
	if channel.Id == 0 {
		return errors.New("channel.Id 不能为空")
	}
	isNewTx := false
	// 如果没有传入事务，创建新的事务
	if tx == nil {
		tx = DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		isNewTx = true
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()
	}
	tx = WithTenantBypass(tx)

	// First delete all abilities of this channel
	err := tx.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
	if err != nil {
		if isNewTx {
			tx.Rollback()
		}
		return err
	}

	// Then add new abilities
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				TenantId:  channel.TenantId,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
				Scope:     channel.Scope,
			}
			abilities = append(abilities, ability)
		}
	}

	if len(abilities) > 0 {
		err = createAbilityRows(tx, abilities)
		if err != nil {
			if isNewTx {
				tx.Rollback()
			}
			return err
		}
	}

	// 如果是新创建的事务，需要提交
	if isNewTx {
		return tx.Commit().Error
	}

	return nil
}

// UpdateAbilityStatus 更新某个渠道的 abilities.enabled。
// tenantId > 0 → 走租户路径，只改该租户自有的 abilities 行。
// tenantId == 0 → 平台渠道：按 channel_id 全量改（跨 0），绕过守门员。
func UpdateAbilityStatus(tenantId int, channelId int, status bool) error {
	if channelId <= 0 {
		return errors.New("channelId 不能为空")
	}
	q := DB.Model(&Ability{})
	if tenantId <= 0 {
		q = WithTenantBypass(q).Where("channel_id = ?", channelId)
	} else {
		q = q.Where("channel_id = ? AND tenant_id = ?", channelId, tenantId)
	}
	return q.Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityStatusByTag(tag string, status bool, tenantId int) error {
	if tenantId <= 0 {
		return errors.New("tenantId 不能为空")
	}
	return DB.Model(&Ability{}).
		Where("tag = ? AND tenant_id = ?", tag, tenantId).
		Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityByTag(tag string, newTag *string, priority *int64, weight *uint, tenantId int) error {
	if tenantId <= 0 {
		return errors.New("tenantId 不能为空")
	}
	ability := Ability{}
	if newTag != nil {
		ability.Tag = newTag
	}
	if priority != nil {
		ability.Priority = priority
	}
	if weight != nil {
		ability.Weight = *weight
	}
	return DB.Model(&Ability{}).
		Where("tag = ? AND tenant_id = ?", tag, tenantId).
		Updates(ability).Error
}

var fixLock = sync.Mutex{}

// FixAbility 是平台级跨租户维护操作：清空 abilities 表并根据所有渠道重建。
// 显式用 WithTenantBypass 放行 tenant guardrail（超管 only）。
func FixAbility() (int, int, error) {
	lock := fixLock.TryLock()
	if !lock {
		return 0, 0, errors.New("已经有一个修复任务在运行中，请稍后再试")
	}
	defer fixLock.Unlock()

	bypassDB := WithTenantBypass(DB)

	// truncate abilities table
	if common.UsingSQLite {
		err := bypassDB.Exec("DELETE FROM abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	} else {
		err := bypassDB.Exec("TRUNCATE TABLE abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Truncate abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	}
	var channels []*Channel
	// Find all channels
	err := bypassDB.Model(&Channel{}).Find(&channels).Error
	if err != nil {
		return 0, 0, err
	}
	if len(channels) == 0 {
		return 0, 0, nil
	}
	successCount := 0
	failCount := 0
	for _, chunk := range lo.Chunk(channels, 50) {
		ids := lo.Map(chunk, func(c *Channel, _ int) int { return c.Id })
		// Delete all abilities of this channel
		err = bypassDB.Where("channel_id IN ?", ids).Delete(&Ability{}).Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			failCount += len(chunk)
			continue
		}
		// Then add new abilities
		for _, channel := range chunk {
			err = channel.AddAbilities(nil)
			if err != nil {
				common.SysLog(fmt.Sprintf("Add abilities for channel %d failed: %s", channel.Id, err.Error()))
				failCount++
			} else {
				successCount++
			}
		}
	}
	InitChannelCache()
	return successCount, failCount, nil
}
