# LobeHub 数据库备份运维

## 目录结构

```
scripts/
├── backup-lobe-db.sh   # 自动备份（cron 调用）
├── restore-lobe-db.sh  # 手动恢复
└── README.md           # 本文件
```

## 一次性部署

在服务器上执行：

```bash
cd /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy/scripts

# 1. 给执行权限
chmod +x backup-lobe-db.sh restore-lobe-db.sh

# 2. 准备备份目录
sudo mkdir -p /data/backup/lobehub
sudo chown $(whoami):$(whoami) /data/backup/lobehub

# 3. 测试一次手动备份
./backup-lobe-db.sh

# 4. 检查产物
ls -lh /data/backup/lobehub/
```

## 加入 cron（每天凌晨 3 点自动备份）

```bash
crontab -e
```

加入：

```cron
# LobeHub 数据库每日备份
0 3 * * * /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy/scripts/backup-lobe-db.sh >> /var/log/lobe-backup.log 2>&1
```

查看日志：

```bash
tail -f /var/log/lobe-backup.log
```

## 阿里云 OSS 异地备份（推荐）

### 1. 安装 ossutil

```bash
curl -o /usr/local/bin/ossutil https://gosspublic.alicdn.com/ossutil/1.7.18/ossutil64
chmod +x /usr/local/bin/ossutil
```

### 2. 配置 AccessKey

```bash
ossutil config
# 按提示填入 endpoint / AccessKey ID / AccessKey Secret
# 配置默认存到 ~/.ossutilconfig
```

### 3. 修改备份脚本

打开 `backup-lobe-db.sh`，把 `OSS_BUCKET` 填成你的桶路径：

```bash
OSS_BUCKET="oss://your-bucket-name/lobehub-backup/"
```

### 4. OSS 桶生命周期建议

在 OSS 控制台给该前缀加生命周期规则：

- 30 天后转 **低频访问**（IA）
- 90 天后转 **归档存储**（Archive）
- 365 天后**删除**

成本约 ¥1–5/月（备份文件几百 MB 级别）。

## 恢复操作

⚠️ **恢复会完全覆盖现有数据**，请先确认：

```bash
cd /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy/scripts

# 不带参数：列出可用备份
./restore-lobe-db.sh

# 指定备份恢复
./restore-lobe-db.sh /data/backup/lobehub/lobechat-20260429-030000.sql.gz
```

脚本会：
1. 停止 lobe 容器（防止写入冲突）
2. 终止旧连接 → drop → create 数据库
3. 导入 gz 备份
4. 重启 lobe 容器

恢复完成后用 `docker compose logs lobe -f` 查看启动日志确认。

## 常见问题

### 备份很慢 / 文件很大

- LobeHub 主要数据：messages（聊天记录）、agents、files。早期可能几十 MB；重度使用可达 GB 级。
- pg_dump 走 `--clean --if-exists` 模式，恢复时会清空表重建，比直接 INSERT 快。
- 真出现 GB 级数据时，可考虑改用 `pg_dump -Fc`（自定义压缩格式）+ `pg_restore -j 4`（并行恢复）。

### 我能直接 cp ./data 目录备份吗？

**不行**。容器运行时直接 cp 数据目录会拿到不一致的快照（事务可能未刷盘）。必须用 pg_dump 这种逻辑备份，或者先 `docker compose stop postgresql` 再 cp。

### 想做实时同步备份

考虑搭一个 PostgreSQL 流复制从库，超出本脚本范围。生产强需求场景才需要。
