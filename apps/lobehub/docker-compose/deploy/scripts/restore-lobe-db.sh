#!/usr/bin/env bash
# LobeHub PostgreSQL 恢复脚本
# 用法：./restore-lobe-db.sh <备份文件.sql.gz>
# 例如：./restore-lobe-db.sh /data/backup/lobehub/lobechat-20260429-030000.sql.gz
set -euo pipefail

CONTAINER="lobe-postgres"
DB_NAME="lobechat"
DB_USER="postgres"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

BACKUP_FILE="${1:-}"
if [[ -z "${BACKUP_FILE}" ]] || [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "用法: $0 <备份文件.sql.gz>"
    echo ""
    echo "可用备份："
    ls -lh /data/backup/lobehub/lobechat-*.sql.gz 2>/dev/null || echo "  （无）"
    exit 1
fi

echo "⚠️  即将从 ${BACKUP_FILE} 恢复数据库 ${DB_NAME}"
echo "⚠️  这会【完全覆盖】当前数据！"
read -p "确认请输入 'yes': " confirm
if [[ "${confirm}" != "yes" ]]; then
    echo "已取消"
    exit 0
fi

# 1. 停掉 lobe 主服务，避免恢复时有写入
echo "[1/4] 停止 lobehub 服务..."
cd "${COMPOSE_DIR}"
docker compose stop lobe

# 2. 重建数据库（终止现有连接 + drop + create）
echo "[2/4] 重建数据库 ${DB_NAME}..."
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres <<SQL
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME};
SQL

# 3. 导入备份
echo "[3/4] 导入备份（视数据量可能耗时几分钟）..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}"

# 4. 启动 lobe
echo "[4/4] 启动 lobehub..."
docker compose start lobe

echo ""
echo "✅ 恢复完成。请访问站点确认数据正常。"
echo "   日志: docker compose logs lobe -f"
