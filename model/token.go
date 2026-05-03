package model

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

type Token struct {
	Id                 int     `json:"id"`
	TenantId           int     `json:"tenant_id" gorm:"index;not null;default:1"`
	UserId             int     `json:"user_id" gorm:"index"`
	Key                string  `json:"key" gorm:"type:char(48);uniqueIndex"`
	Status             int     `json:"status" gorm:"default:1"`
	Name               string  `json:"name" gorm:"index" `
	CreatedTime        int64   `json:"created_time" gorm:"bigint"`
	AccessedTime       int64   `json:"accessed_time" gorm:"bigint"`
	ExpiredTime        int64   `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
	RemainQuota        int     `json:"remain_quota" gorm:"default:0"`
	UnlimitedQuota     bool    `json:"unlimited_quota"`
	ModelLimitsEnabled bool    `json:"model_limits_enabled"`
	ModelLimits        string  `json:"model_limits" gorm:"type:text"`
	EnableImageGen     bool    `json:"enable_image_gen" gorm:"not null;default:true"`
	AllowIps           *string `json:"allow_ips" gorm:"default:''"`
	UsedQuota          int     `json:"used_quota" gorm:"default:0"` // used quota
	Group              string  `json:"group" gorm:"default:''"`
	CrossGroupRetry    bool    `json:"cross_group_retry"` // 跨分组重试，仅auto分组有效
	// AppId: AI 应用广场的应用 ID，非零表示此 Token 是为某个 AI 应用生成的 Session Token。
	// 调用日志里会回写 AppId，作为三方结算的唯一依据。
	AppId int `json:"app_id" gorm:"default:0;index"`
	// IsGuest: true 表示此 Token 是为未登录访客生成的体验 Token。
	IsGuest   bool           `json:"is_guest" gorm:"default:false"`
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

func (token *Token) Clean() {
	token.Key = ""
}

func MaskTokenKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	if len(key) <= 8 {
		return key[:2] + "****" + key[len(key)-2:]
	}
	return key[:4] + "**********" + key[len(key)-4:]
}

func (token *Token) GetFullKey() string {
	return token.Key
}

func (token *Token) GetMaskedKey() string {
	return MaskTokenKey(token.Key)
}

func (token *Token) GetIpLimits() []string {
	// delete empty spaces
	//split with \n
	ipLimits := make([]string, 0)
	if token.AllowIps == nil {
		return ipLimits
	}
	cleanIps := strings.ReplaceAll(*token.AllowIps, " ", "")
	if cleanIps == "" {
		return ipLimits
	}
	ips := strings.Split(cleanIps, "\n")
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		ip = strings.ReplaceAll(ip, ",", "")
		if ip != "" {
			ipLimits = append(ipLimits, ip)
		}
	}
	return ipLimits
}

func GetAllUserTokens(userId int, startIdx int, num int, tenantId int) ([]*Token, error) {
	var tokens []*Token
	err := DB.Where("tenant_id = ? AND user_id = ?", tenantId, userId).
		Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error
	return tokens, err
}

// sanitizeLikePattern 校验并清洗用户输入的 LIKE 搜索模式。
// 规则：
//  1. 转义 ! 和 _（使用 ! 作为 ESCAPE 字符，兼容 MySQL/PostgreSQL/SQLite）
//  2. 连续的 % 合并为单个 %
//  3. 最多允许 2 个 %
//  4. 含 % 时（模糊搜索），去掉 % 后关键词长度必须 >= 2
//  5. 不含 % 时按精确匹配
func sanitizeLikePattern(input string) (string, error) {
	// 1. 先转义 ESCAPE 字符 ! 自身，再转义 _
	//    使用 ! 而非 \ 作为 ESCAPE 字符，避免 MySQL 中反斜杠的字符串转义问题
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, `_`, `!_`)

	// 2. 连续的 % 直接拒绝
	if strings.Contains(input, "%%") {
		return "", errors.New("搜索模式中不允许包含连续的 % 通配符")
	}

	// 3. 统计 % 数量，不得超过 2
	count := strings.Count(input, "%")
	if count > 2 {
		return "", errors.New("搜索模式中最多允许包含 2 个 % 通配符")
	}

	// 4. 含 % 时，去掉 % 后关键词长度必须 >= 2
	if count > 0 {
		stripped := strings.ReplaceAll(input, "%", "")
		if len(stripped) < 2 {
			return "", errors.New("使用模糊搜索时，关键词长度至少为 2 个字符")
		}
		return input, nil
	}

	// 5. 无 % 时，精确全匹配
	return input, nil
}

const searchHardLimit = 100

func SearchUserTokens(userId int, keyword string, token string, offset int, limit int, tenantId int) (tokens []*Token, total int64, err error) {
	// model 层强制截断
	if limit <= 0 || limit > searchHardLimit {
		limit = searchHardLimit
	}
	if offset < 0 {
		offset = 0
	}

	if token != "" {
		token = strings.TrimPrefix(token, "sk-")
	}

	// 超量用户（令牌数超过上限）只允许精确搜索，禁止模糊搜索
	maxTokens := operation_setting.GetMaxUserTokens()
	hasFuzzy := strings.Contains(keyword, "%") || strings.Contains(token, "%")
	if hasFuzzy {
		count, err := CountUserTokens(userId, tenantId)
		if err != nil {
			common.SysLog("failed to count user tokens: " + err.Error())
			return nil, 0, errors.New("获取令牌数量失败")
		}
		if int(count) > maxTokens {
			return nil, 0, errors.New("令牌数量超过上限，仅允许精确搜索，请勿使用 % 通配符")
		}
	}

	baseQuery := DB.Model(&Token{}).Where("tenant_id = ? AND user_id = ?", tenantId, userId)

	// 非空才加 LIKE 条件，空则跳过（不过滤该字段）
	if keyword != "" {
		keywordPattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where("name LIKE ? ESCAPE '!'", keywordPattern)
	}
	if token != "" {
		tokenPattern, err := sanitizeLikePattern(token)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where(commonKeyCol+" LIKE ? ESCAPE '!'", tokenPattern)
	}

	// 先查匹配总数（用于分页，受 maxTokens 上限保护，避免全表 COUNT）
	err = baseQuery.Limit(maxTokens).Count(&total).Error
	if err != nil {
		common.SysError("failed to count search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}

	// 再分页查数据
	err = baseQuery.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	if err != nil {
		common.SysError("failed to search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}
	return tokens, total, nil
}

func ValidateUserToken(key string) (token *Token, err error) {
	return nil, fmt.Errorf("%w: use ValidateUserTokenWithContext or ValidateUserTokenGlobal explicitly", ErrTenantRequired)
}

func ValidateUserTokenGlobal(key string) (token *Token, err error) {
	return ValidateUserTokenWithContext(context.Background(), key)
}

func ValidateUserTokenWithContext(ctx context.Context, key string) (token *Token, err error) {
	if key == "" {
		return nil, errors.New("未提供令牌")
	}
	token, err = GetTokenByKeyWithContext(ctx, key, false)
	if err == nil {
		if token.Status == common.TokenStatusExhausted {
			keyPrefix := key[:3]
			keySuffix := key[len(key)-3:]
			return token, errors.New("该令牌额度已用尽 TokenStatusExhausted[sk-" + keyPrefix + "***" + keySuffix + "]")
		} else if token.Status == common.TokenStatusExpired {
			return token, errors.New("该令牌已过期")
		}
		if token.Status != common.TokenStatusEnabled {
			return token, errors.New("该令牌状态不可用")
		}
		if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExpired
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			return token, errors.New("该令牌已过期")
		}
		if !token.UnlimitedQuota && token.RemainQuota <= 0 {
			if !common.RedisEnabled {
				// in this case, we can make sure the token is exhausted
				token.Status = common.TokenStatusExhausted
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			keyPrefix := key[:3]
			keySuffix := key[len(key)-3:]
			return token, fmt.Errorf("[sk-%s***%s] 该令牌额度已用尽 !token.UnlimitedQuota && token.RemainQuota = %d", keyPrefix, keySuffix, token.RemainQuota)
		}
		return token, nil
	}
	common.SysLog("ValidateUserToken: failed to get token: " + err.Error())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("无效的令牌")
	} else {
		return nil, errors.New("无效的令牌，数据库查询出错，请联系管理员")
	}
}

func GetTokenByIds(id int, userId int) (*Token, error) {
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	var err error = nil
	err = DB.First(&token, "id = ? and user_id = ?", id, userId).Error
	return &token, err
}

func GetTokenById(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	token := Token{Id: id}
	var err error = nil
	err = DB.First(&token, "id = ?", id).Error
	if shouldUpdateRedis(true, err) {
		gopool.Go(func() {
			if err := cacheSetToken(token); err != nil {
				common.SysLog("failed to update user status cache: " + err.Error())
			}
		})
	}
	return &token, err
}

func GetTokenByKey(key string, fromDB bool) (token *Token, err error) {
	return nil, fmt.Errorf("%w: use GetTokenByKeyWithContext or GetTokenByKeyGlobal explicitly", ErrTenantRequired)
}

func GetTokenByKeyGlobal(key string, fromDB bool) (token *Token, err error) {
	return GetTokenByKeyWithContext(context.Background(), key, fromDB)
}

func GetTokenByKeyWithContext(ctx context.Context, key string, fromDB bool) (token *Token, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) && token != nil {
			gopool.Go(func() {
				if err := cacheSetToken(*token); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		// Try Redis first
		token, err := cacheGetTokenByKey(key)
		if err == nil {
			// Verify cached token belongs to the requesting tenant
			if tenantId := ExplicitTenantIDFromContext(ctx); tenantId > 0 && token.TenantId != tenantId {
				// Tenant mismatch — treat as cache miss, fall through to DB
			} else {
				return token, nil
			}
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	q := DB
	if ctx != nil {
		q = DB.WithContext(ctx)
	}
	// Token.Key 是全局唯一凭证（schema 上挂了 uniqueIndex），按 key 查找属于
	// 鉴权前置操作，不能被当前 ctx 的 tenant scope 过滤掉 —— 外部 API 请求
	// 纯靠 sk-key 鉴权时 ctx 里没有 tenant，TenantIDFromContext 会 fallback 到
	// DefaultTenantId=1，历史上导致非默认租户的 key 永远查不到。
	// 租户一致性由上层调用方（middleware.TokenAuth 等）负责校验。
	// Token keys are global identifiers. Resolve them explicitly without tenant
	// scoping, then let higher-level auth enforce tenant ownership.
	q = WithTenantBypass(q)
	err = q.Where(commonKeyCol+" = ?", key).First(&token).Error
	return token, err
}

func (token *Token) Insert() error {
	var err error
	err = DB.Create(token).Error
	return err
}

// scopedQuery 返回一个限定到当前 token (id, tenant_id) 的 *gorm.DB。
// 校验 Id / TenantId 非空，满足 tenant guardrail 的 fail-closed 要求。
func (token *Token) scopedQuery() (*gorm.DB, error) {
	if token.Id == 0 || token.TenantId == 0 {
		return nil, errors.New("token.Id 和 token.TenantId 不能为空")
	}
	return DB.Model(&Token{}).Where("id = ? AND tenant_id = ?", token.Id, token.TenantId), nil
}

// refreshTokenCacheAfterWrite 在成功写库后异步刷新 Redis 缓存。
// setCache=true 表示把当前 token 写回缓存；false 表示删除缓存。
func (token *Token) refreshTokenCacheAfterWrite(err error, setCache bool) {
	if !shouldUpdateRedis(true, err) {
		return
	}
	snapshot := *token
	gopool.Go(func() {
		var cacheErr error
		if setCache {
			cacheErr = cacheSetToken(snapshot)
		} else {
			cacheErr = cacheDeleteToken(snapshot.Key)
		}
		if cacheErr != nil {
			common.SysLog("failed to refresh token cache: " + cacheErr.Error())
		}
	})
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (token *Token) Update() (err error) {
	q, err := token.scopedQuery()
	if err != nil {
		return err
	}
	defer func() { token.refreshTokenCacheAfterWrite(err, true) }()
	err = q.Select("name", "status", "expired_time", "remain_quota", "unlimited_quota",
		"model_limits_enabled", "model_limits", "enable_image_gen", "allow_ips", "group", "cross_group_retry").
		Updates(token).Error
	return err
}

func (token *Token) SelectUpdate() (err error) {
	q, err := token.scopedQuery()
	if err != nil {
		return err
	}
	defer func() { token.refreshTokenCacheAfterWrite(err, true) }()
	// This can update zero values
	err = q.Select("accessed_time", "status").Updates(token).Error
	return err
}

func (token *Token) Delete() (err error) {
	q, err := token.scopedQuery()
	if err != nil {
		return err
	}
	defer func() { token.refreshTokenCacheAfterWrite(err, false) }()
	err = q.Delete(&Token{}).Error
	return err
}

func (token *Token) IsModelLimitsEnabled() bool {
	return token.ModelLimitsEnabled
}

func (token *Token) GetModelLimits() []string {
	if token.ModelLimits == "" {
		return []string{}
	}
	return strings.Split(token.ModelLimits, ",")
}

func (token *Token) GetModelLimitsMap() map[string]bool {
	limits := token.GetModelLimits()
	limitsMap := make(map[string]bool)
	for _, limit := range limits {
		limitsMap[limit] = true
	}
	return limitsMap
}

func DisableModelLimits(tokenId int) error {
	token, err := GetTokenById(tokenId)
	if err != nil {
		return err
	}
	token.ModelLimitsEnabled = false
	token.ModelLimits = ""
	return token.Update()
}

func DeleteTokenById(id int, userId int) (err error) {
	// Why we need userId here? In case user want to delete other's token.
	if id == 0 || userId == 0 {
		return errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	err = DB.Where(token).First(&token).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

func IncreaseTokenQuota(tokenId int, key string, quota int, tenantId ...int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			err := cacheIncrTokenQuota(key, int64(quota))
			if err != nil {
				common.SysLog("failed to increase token quota: " + err.Error())
			}
		})
	}
	if common.BatchUpdateEnabled {
		resolvedTenantId := 0
		if len(tenantId) > 0 {
			resolvedTenantId = tenantId[0]
		}
		addNewRecord(BatchUpdateTypeTokenQuota, resolvedTenantId, tokenId, quota)
		return nil
	}
	return increaseTokenQuota(tokenId, quota, tenantId...)
}

func increaseTokenQuota(id int, quota int, tenantId ...int) (err error) {
	query := DB.Model(&Token{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err = query.Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota + ?", quota),
			"used_quota":    gorm.Expr("used_quota - ?", quota),
			"accessed_time": common.GetTimestamp(),
		},
	).Error
	return err
}

func DecreaseTokenQuota(id int, key string, quota int, tenantId ...int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			err := cacheDecrTokenQuota(key, int64(quota))
			if err != nil {
				common.SysLog("failed to decrease token quota: " + err.Error())
			}
		})
	}
	if common.BatchUpdateEnabled {
		resolvedTenantId := 0
		if len(tenantId) > 0 {
			resolvedTenantId = tenantId[0]
		}
		addNewRecord(BatchUpdateTypeTokenQuota, resolvedTenantId, id, -quota)
		return nil
	}
	return decreaseTokenQuota(id, quota, tenantId...)
}

func decreaseTokenQuota(id int, quota int, tenantId ...int) (err error) {
	query := DB.Model(&Token{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err = query.Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		},
	).Error
	return err
}

// CountUserTokens returns total number of tokens for the given user, used for pagination
func CountUserTokens(userId int, tenantId int) (int64, error) {
	var total int64
	err := DB.Model(&Token{}).Where("tenant_id = ? AND user_id = ?", tenantId, userId).Count(&total).Error
	return total, err
}

// CountTenantTokens returns the number of non-deleted tokens owned by the tenant.
// Used to enforce TenantPlan.MaxTokens at token-creation time.
func CountTenantTokens(tenantId int) (int64, error) {
	if tenantId <= 0 {
		return 0, fmt.Errorf("invalid tenantId: %d", tenantId)
	}
	var count int64
	err := DB.Model(&Token{}).Where("tenant_id = ?", tenantId).Count(&count).Error
	return count, err
}

// BatchDeleteTokens 删除指定用户的一组令牌，返回成功删除数量
func BatchDeleteTokens(ids []int, userId int, tenantId int) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("tenant_id = ? AND user_id = ? AND id IN (?)", tenantId, userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Where("tenant_id = ? AND user_id = ? AND id IN (?)", tenantId, userId, ids).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return len(tokens), nil
}

func GetTokenKeysByIds(ids []int, userId int) ([]Token, error) {
	var tokens []Token
	err := DB.Select("id", commonKeyCol).
		Where("user_id = ? AND id IN (?)", userId, ids).
		Find(&tokens).Error
	return tokens, err
}

// GetTokenByIdsTenant is the tenant-aware variant of GetTokenByIds.
// Controllers use this to enforce tenant isolation on user-scoped token lookups.
// Fail-closed: rejects any of id/userId/tenantId being 0.
func GetTokenByIdsTenant(id, userId, tenantId int) (*Token, error) {
	if id == 0 || userId == 0 || tenantId == 0 {
		return nil, errors.New("id, userId, tenantId are required")
	}
	token := Token{Id: id, UserId: userId, TenantId: tenantId}
	err := DB.First(&token, "id = ? AND user_id = ? AND tenant_id = ?", id, userId, tenantId).Error
	return &token, err
}

// GetTokenKeysByIdsTenant is the tenant-aware variant of GetTokenKeysByIds.
func GetTokenKeysByIdsTenant(ids []int, userId, tenantId int) ([]Token, error) {
	if len(ids) == 0 || userId == 0 || tenantId == 0 {
		return nil, errors.New("ids, userId, tenantId are required")
	}
	var tokens []Token
	err := DB.Select("id", commonKeyCol).
		Where("user_id = ? AND tenant_id = ? AND id IN (?)", userId, tenantId, ids).
		Find(&tokens).Error
	return tokens, err
}

// DeleteTokenByIdTenant is the tenant-aware variant of DeleteTokenById.
func DeleteTokenByIdTenant(id, userId, tenantId int) error {
	if id == 0 || userId == 0 || tenantId == 0 {
		return errors.New("id, userId, tenantId are required")
	}
	token := Token{Id: id, UserId: userId, TenantId: tenantId}
	if err := DB.Where(token).First(&token).Error; err != nil {
		return err
	}
	return token.Delete()
}
