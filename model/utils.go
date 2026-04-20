package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	BatchUpdateTypeUserQuota = iota
	BatchUpdateTypeTokenQuota
	BatchUpdateTypeUsedQuota
	BatchUpdateTypeChannelUsedQuota
	BatchUpdateTypeRequestCount
	BatchUpdateTypeCount // if you add a new type, you need to add a new map and a new lock
)

var batchUpdateStores []map[string]int
var batchUpdateLocks []sync.Mutex

func init() {
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateStores = append(batchUpdateStores, make(map[string]int))
		batchUpdateLocks = append(batchUpdateLocks, sync.Mutex{})
	}
}

func InitBatchUpdater() {
	gopool.Go(func() {
		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}

func buildBatchUpdateKey(tenantId int, id int) string {
	return fmt.Sprintf("%d:%d", tenantId, id)
}

func parseBatchUpdateKey(key string) (tenantId int, id int, err error) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0, errors.New("invalid batch update key")
	}
	tenantId, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, err
	}
	id, err = strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, err
	}
	return tenantId, id, nil
}

func addNewRecord(type_ int, tenantId int, id int, value int) {
	batchUpdateLocks[type_].Lock()
	defer batchUpdateLocks[type_].Unlock()
	key := buildBatchUpdateKey(tenantId, id)
	if _, ok := batchUpdateStores[type_][key]; !ok {
		batchUpdateStores[type_][key] = value
	} else {
		batchUpdateStores[type_][key] += value
	}
}

func batchUpdate() {
	// check if there's any data to update
	hasData := false
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		if len(batchUpdateStores[i]) > 0 {
			hasData = true
			batchUpdateLocks[i].Unlock()
			break
		}
		batchUpdateLocks[i].Unlock()
	}

	if !hasData {
		return
	}

	common.SysLog("batch update started")
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		store := batchUpdateStores[i]
		batchUpdateStores[i] = make(map[string]int)
		batchUpdateLocks[i].Unlock()
		// TODO: maybe we can combine updates with same key?
		for key, value := range store {
			tenantId, entityId, err := parseBatchUpdateKey(key)
			if err != nil {
				common.SysLog("failed to parse batch update key: " + err.Error())
				continue
			}
			switch i {
			case BatchUpdateTypeUserQuota:
				err := increaseUserQuota(entityId, value, tenantId)
				if err != nil {
					common.SysLog("failed to batch update user quota: " + err.Error())
				}
			case BatchUpdateTypeTokenQuota:
				err := increaseTokenQuota(entityId, value, tenantId)
				if err != nil {
					common.SysLog("failed to batch update token quota: " + err.Error())
				}
			case BatchUpdateTypeUsedQuota:
				updateUserUsedQuota(entityId, value, tenantId)
			case BatchUpdateTypeRequestCount:
				updateUserRequestCount(entityId, value, tenantId)
			case BatchUpdateTypeChannelUsedQuota:
				updateChannelUsedQuota(entityId, value, tenantId)
			}
		}
	}
	common.SysLog("batch update finished")
}

func RecordExist(err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return false, err
}

func shouldUpdateRedis(fromDB bool, err error) bool {
	return common.RedisEnabled && fromDB && err == nil
}
