package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm/clause"
)

type SiteRPMSnapshot struct {
	Id            int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt     int64   `json:"created_at" gorm:"index:idx_rpm_window_ts,priority:2;uniqueIndex:uk_rpm_snapshot,priority:1"`
	WindowSeconds int     `json:"window_seconds" gorm:"index:idx_rpm_window_ts,priority:1;uniqueIndex:uk_rpm_snapshot,priority:2"`
	SiteLabel     string  `json:"site_label" gorm:"type:varchar(128);uniqueIndex:uk_rpm_snapshot,priority:3"`
	RPM           float64 `json:"rpm"`
	Count         int64   `json:"count"`
}

func (SiteRPMSnapshot) TableName() string {
	return "site_rpm_snapshots"
}

func StartSiteRPMSnapshotWriter() {
	for {
		time.Sleep(5 * time.Second)
		now := time.Now().Unix()
		ts := now - (now % 5)

		result, err := GetSiteRPM(60)
		if err != nil {
			common.SysError("SiteRPMSnapshotWriter GetSiteRPM error: " + err.Error())
			continue
		}

		rows := make([]SiteRPMSnapshot, 0, len(result.Sites)+1)
		rows = append(rows, SiteRPMSnapshot{
			CreatedAt:     ts,
			WindowSeconds: int(result.WindowSeconds),
			SiteLabel:     "__ALL__",
			RPM:           result.All.RPM,
		})
		for _, s := range result.Sites {
			rows = append(rows, SiteRPMSnapshot{
				CreatedAt:     ts,
				WindowSeconds: int(result.WindowSeconds),
				SiteLabel:     s.SiteLabel,
				RPM:           s.RPM,
			})
		}

		err = DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "created_at"}, {Name: "window_seconds"}, {Name: "site_label"}},
			DoUpdates: clause.AssignmentColumns([]string{"rpm", "count"}),
		}).CreateInBatches(rows, 100).Error
		if err != nil {
			common.SysError("SiteRPMSnapshotWriter upsert error: " + err.Error())
		}
	}
}

func GetSiteRPMHistory(windowSeconds int, rangeSeconds int64, since int64, startTs int64, endTs int64) ([]SiteRPMSnapshot, error) {
	var snapshots []SiteRPMSnapshot
	var err error
	if startTs > 0 && endTs > 0 {
		err = DB.Where("window_seconds = ? AND created_at >= ? AND created_at <= ?", windowSeconds, startTs, endTs).
			Order("created_at").Find(&snapshots).Error
	} else if since > 0 {
		err = DB.Where("window_seconds = ? AND created_at > ?", windowSeconds, since).
			Order("created_at").Find(&snapshots).Error
	} else {
		cutoff := time.Now().Unix() - rangeSeconds
		err = DB.Where("window_seconds = ? AND created_at >= ?", windowSeconds, cutoff).
			Order("created_at").Find(&snapshots).Error
	}
	return snapshots, err
}
