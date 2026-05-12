package model

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"

	"github.com/bytedance/gopkg/util/gopool"
)

// UserBase struct remains the same as it represents the cached data structure
type UserBase struct {
	Id       int    `json:"id"`
	Group    string `json:"group"`
	Email    string `json:"email"`
	Quota    int    `json:"quota"`
	Status   int    `json:"status"`
	Username string `json:"username"`
	Setting  string `json:"setting"`
}

func (user *UserBase) WriteContext(c *gin.Context) {
	common.SetContextKey(c, constant.ContextKeyUserGroup, user.Group)
	common.SetContextKey(c, constant.ContextKeyUserQuota, user.Quota)
	common.SetContextKey(c, constant.ContextKeyUserStatus, user.Status)
	common.SetContextKey(c, constant.ContextKeyUserEmail, user.Email)
	common.SetContextKey(c, constant.ContextKeyUserName, user.Username)
	common.SetContextKey(c, constant.ContextKeyUserSetting, user.GetSetting())
}

func (user *UserBase) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := common.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

// getUserCacheKey returns the key for user cache
func getUserCacheKey(userId int) string {
	return fmt.Sprintf("user:%d", userId)
}

// invalidateUserCache clears user cache
func invalidateUserCache(userId int) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisDelKey(getUserCacheKey(userId))
}

// updateUserCache updates all user cache fields using hash.
//
// IMPORTANT — concurrency note:
// The Quota field is mutated via HIncrBy from cacheIncrUserQuota /
// cacheDecrUserQuota during pre-consume / settle / refund. If we re-use
// HSetObj here (which overwrites the entire hash with the current DB
// snapshot), any HIncrBy that fired BETWEEN our DB read and this Redis
// write gets silently CLOBBERED — its delta is lost in the cache. With a
// 60s cache TTL and 5s batch-update interval, the DB snapshot we just
// read is also stale relative to in-flight batch entries, which means
// HSetObj systematically reverts cache to a pre-batch-flush value.
// Under load this manifests as user balance "bouncing back" / not
// decreasing as expected (user appears to have been undercharged).
//
// Fix: write the non-Quota fields individually (HSet per field) and
// only initialize Quota via HSETNX so a concurrent HIncrBy that already
// created the field is preserved. The Quota field is owned by
// HIncrBy and will be lazily seeded from DB on first read after eviction.
func updateUserCache(user User) error {
	if !common.RedisEnabled {
		return nil
	}

	key := getUserCacheKey(user.Id)
	base := user.ToBaseUser()
	ttl := time.Duration(common.RedisKeyCacheSeconds()) * time.Second

	// Seed Quota only when the field does not exist yet — never clobber
	// in-flight HIncrBy values.
	if err := common.RedisHSetNXField(key, "Quota", fmt.Sprintf("%d", base.Quota)); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Id", fmt.Sprintf("%d", base.Id)); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Group", base.Group); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Email", base.Email); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Status", fmt.Sprintf("%d", base.Status)); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Username", base.Username); err != nil {
		return err
	}
	if err := common.RedisHSetField(key, "Setting", base.Setting); err != nil {
		return err
	}
	return common.RedisExpire(key, ttl)
}

// GetUserCache gets complete user cache from hash
func GetUserCache(userId int) (userCache *UserBase, err error) {
	return nil, fmt.Errorf("%w: use GetUserCacheWithContext for tenant-scoped reads or GetUserCacheGlobal for explicit global reads", ErrTenantRequired)
}

func GetUserCacheWithContext(ctx context.Context, userId int) (userCache *UserBase, err error) {
	var user *User
	var fromDB bool
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) && user != nil {
			gopool.Go(func() {
				if err := updateUserCache(*user); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()

	// Try getting from Redis first
	userCache, err = cacheGetUserBase(userId)
	if err == nil {
		return userCache, nil
	}

	// If Redis fails, get from DB
	fromDB = true
	user, err = GetUserByIdWithContext(ctx, userId, false)
	if err != nil {
		return nil, err // Return nil and error if DB lookup fails
	}

	// Create cache object from user data
	userCache = &UserBase{
		Id:       user.Id,
		Group:    user.Group,
		Quota:    user.Quota,
		Status:   user.Status,
		Username: user.Username,
		Setting:  user.Setting,
		Email:    user.Email,
	}

	return userCache, nil
}

func GetUserCacheGlobal(userId int) (userCache *UserBase, err error) {
	var user *User
	var fromDB bool
	defer func() {
		if shouldUpdateRedis(fromDB, err) && user != nil {
			gopool.Go(func() {
				if err := updateUserCache(*user); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()

	userCache, err = cacheGetUserBase(userId)
	if err == nil {
		return userCache, nil
	}

	fromDB = true
	user, err = GetUserByIdGlobal(userId, false)
	if err != nil {
		return nil, err
	}

	userCache = &UserBase{
		Id:       user.Id,
		Group:    user.Group,
		Quota:    user.Quota,
		Status:   user.Status,
		Username: user.Username,
		Setting:  user.Setting,
		Email:    user.Email,
	}

	return userCache, nil
}

func cacheGetUserBase(userId int) (*UserBase, error) {
	if !common.RedisEnabled {
		return nil, fmt.Errorf("redis is not enabled")
	}
	var userCache UserBase
	// Try getting from Redis first
	err := common.RedisHGetObj(getUserCacheKey(userId), &userCache)
	if err != nil {
		return nil, err
	}
	// Guard against partial hashes: cacheIncrUserQuota uses HIncrBy, which
	// auto-creates a hash containing only the Quota field if the key was
	// evicted. Reading that back yields Status=0 (zero value), which is
	// neither Enabled (1) nor Disabled (2) and would falsely trip the
	// "用户已被封禁" check in TokenAuth. Treat Status==0 as cache miss so
	// the caller falls through to DB and reseeds all fields via updateUserCache.
	if userCache.Status == 0 {
		return nil, fmt.Errorf("user cache for %d is incomplete (missing Status), forcing DB reload", userId)
	}
	return &userCache, nil
}

// Add atomic quota operations using hash fields
func cacheIncrUserQuota(userId int, delta int64) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHIncrBy(getUserCacheKey(userId), "Quota", delta)
}

// CacheIncrUserQuota is the exported form of cacheIncrUserQuota. Payment
// success handlers (service/payment/order.go) call it from *postCommit*
// after the DB tx commits — never from inside a tx, because the cache
// and DB writes must not diverge on tx rollback (see
// ApplyPaymentSuccess in service/payment/order.go).
func CacheIncrUserQuota(id int, quota int64) error {
	return cacheIncrUserQuota(id, quota)
}

func cacheDecrUserQuota(userId int, delta int64) error {
	return cacheIncrUserQuota(userId, -delta)
}

// Helper functions to get individual fields if needed
func getUserGroupCache(userId int) (string, error) {
	cache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return "", err
	}
	return cache.Group, nil
}

func getUserQuotaCache(userId int) (int, error) {
	cache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return 0, err
	}
	return cache.Quota, nil
}

func getUserStatusCache(userId int) (int, error) {
	cache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return 0, err
	}
	return cache.Status, nil
}

func getUserNameCache(userId int) (string, error) {
	cache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return "", err
	}
	return cache.Username, nil
}

func getUserSettingCache(userId int) (dto.UserSetting, error) {
	cache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return dto.UserSetting{}, err
	}
	return cache.GetSetting(), nil
}

// New functions for individual field updates
func updateUserStatusCache(userId int, status bool) error {
	if !common.RedisEnabled {
		return nil
	}
	statusInt := common.UserStatusEnabled
	if !status {
		statusInt = common.UserStatusDisabled
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Status", fmt.Sprintf("%d", statusInt))
}

// updateUserQuotaCache is called from GetUserQuota's defer when the cache
// missed and we had to read from DB. The naïve HSetField approach would
// CLOBBER any HIncrBy operations that fired between the DB read and this
// write — exact same race that caused user balance to "bounce back" /
// users to be undercharged.
//
// Use HSETNX so we only seed the Quota field when it does not exist
// yet. If HIncrBy already created/incremented the field concurrently,
// we leave it alone — its value is closer to truth than our stale DB
// snapshot (which lags by up to BatchUpdateInterval).
func updateUserQuotaCache(userId int, quota int) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetNXField(getUserCacheKey(userId), "Quota", fmt.Sprintf("%d", quota))
}

func updateUserGroupCache(userId int, group string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Group", group)
}

func UpdateUserGroupCache(userId int, group string) error {
	return updateUserGroupCache(userId, group)
}

func updateUserNameCache(userId int, username string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Username", username)
}

func updateUserSettingCache(userId int, setting string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Setting", setting)
}

// GetUserLanguage returns the user's language preference from cache
// Uses the existing GetUserCache mechanism for efficiency
func GetUserLanguage(userId int) string {
	userCache, err := GetUserCacheGlobal(userId)
	if err != nil {
		return ""
	}
	return userCache.GetSetting().Language
}
