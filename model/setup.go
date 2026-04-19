package model

// CurrentSchemaVersion 表示当前代码所期望的数据库 schema 版本。
// 格式约定：YYYY-MM-DD 或 YYYY-MM-DD.NN。每当新增/删除表、改列类型或其他
// 需要 AutoMigrate 才能生效的 schema 改动时，bump 这个值，启动时就会自动
// 跑一次完整迁移；不 bump 的话日常重启直接跳过 AutoMigrate 省时间。
const CurrentSchemaVersion = "2026-04-19.01"

type Setup struct {
	ID            uint   `json:"id" gorm:"primaryKey"`
	Version       string `json:"version" gorm:"type:varchar(50);not null"`
	SchemaVersion string `json:"schema_version" gorm:"type:varchar(50);default:''"`
	InitializedAt int64  `json:"initialized_at" gorm:"type:bigint;not null"`
}

func GetSetup() *Setup {
	var setup Setup
	err := DB.First(&setup).Error
	if err != nil {
		return nil
	}
	return &setup
}

// GetSchemaVersion 读取数据库里保存的 schema 版本。
// 首次启动（Setup 表为空）或老库升级（列存在但值为空）时返回 ""。
func GetSchemaVersion() string {
	setup := GetSetup()
	if setup == nil {
		return ""
	}
	return setup.SchemaVersion
}

// SaveSchemaVersion 将 SchemaVersion 写入 Setup 行。
// 没有 Setup 行时新建一行（只含 schema_version，其它字段由安装向导后续补）；
// 有则只更新 SchemaVersion 列，不动 Version / InitializedAt。
func SaveSchemaVersion(version string) error {
	var setup Setup
	err := DB.First(&setup).Error
	if err != nil {
		return DB.Create(&Setup{SchemaVersion: version}).Error
	}
	return DB.Model(&setup).Update("schema_version", version).Error
}
