#!/usr/bin/env bash
# LobeHub PostgreSQL 自动备份脚本
# 用法：直接执行 或 加入 crontab
#   0 3 * * * /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy/scripts/backup-lobe-db.sh
set -euo pipefail

# ============ 配置区 ============
CONTAINER="lobe-postgres"          # paradedb 容器名
DB_NAME="lobechat"                 # 与 .env 里 LOBE_DB_NAME 一致
DB_USER="postgres"
BACKUP_DIR="/data/backup/lobehub"  # 本地备份目录
RETENTION_DAYS=14                  # 本地保留天数

# ====== OSS 异地备份（可选）======
# 留空 = 不上传 OSS。配置后会自动上传，并按桶生命周期策略归档
OSS_BUCKET=""                      # 例：oss://my-backup-bucket/lobe/
OSSUTIL_CONFIG="/root/.ossutilconfig"  # ossutil 配置文件路径

# ============ 执行区 ============
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/lobechat-${TIMESTAMP}.sql.gz"
LOG_PREFIX="[$(date '+%F %T')]"

mkdir -p "${BACKUP_DIR}"

echo "${LOG_PREFIX} 开始备份 ${DB_NAME} → ${BACKUP_FILE}"

# 1. pg_dump（压缩管道，避免落临时文件）
if ! docker exec -i "${CONTAINER}" pg_dump \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --no-owner \
        --clean \
        --if-exists \
        | gzip -9 > "${BACKUP_FILE}"; then
    echo "${LOG_PREFIX} ❌ pg_dump 失败" >&2
    rm -f "${BACKUP_FILE}"
    exit 1
fi

# 2. 校验文件不为空且能正常解压
if [[ ! -s "${BACKUP_FILE}" ]] || ! gzip -t "${BACKUP_FILE}" 2>/dev/null; then
    echo "${LOG_PREFIX} ❌ 备份文件损坏: ${BACKUP_FILE}" >&2
    rm -f "${BACKUP_FILE}"
    exit 1
fi

SIZE=$(du -h "${BACKUP_FILE}" | awk '{print $1}')
echo "${LOG_PREFIX} ✅ 备份完成 (${SIZE})"

# 3. 上传 OSS（可选）
if [[ -n "${OSS_BUCKET}" ]]; then
    if command -v ossutil >/dev/null 2>&1; then
        echo "${LOG_PREFIX} 上传到 ${OSS_BUCKET}..."
        if ossutil cp -c "${OSSUTIL_CONFIG}" "${BACKUP_FILE}" "${OSS_BUCKET}" --force; then
            echo "${LOG_PREFIX} ✅ OSS 上传完成"
        else
            echo "${LOG_PREFIX} ⚠️  OSS 上传失败（本地备份仍保留）" >&2
        fi
    else
        echo "${LOG_PREFIX} ⚠️  未安装 ossutil，跳过上传" >&2
    fi
fi

# 4. 清理过期本地备份
echo "${LOG_PREFIX} 清理 ${RETENTION_DAYS} 天前的本地备份..."
find "${BACKUP_DIR}" -name 'lobechat-*.sql.gz' -mtime +${RETENTION_DAYS} -print -delete

echo "${LOG_PREFIX} 全部完成"
