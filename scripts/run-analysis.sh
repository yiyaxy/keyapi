#!/bin/bash
# CaMeL AI 定时分析 wrapper
# 用法: bash run-analysis.sh daily|weekly|monthly|trend
# crontab 调用此脚本，CC 会根据 /camel-analysis skill 自主判断和执行

set -euo pipefail

REPORT_TYPE="${1:-daily}"
PROJECT_DIR="/home/bigdata/lmy/CaMeL-api"
CLAUDE_BIN="/home/bigdata/.local/bin/claude"
LOG_DIR="${PROJECT_DIR}/logs"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting $REPORT_TYPE analysis..."

# 让 CC 自主执行分析，通过 /camel-analysis skill 获取完整指导
"$CLAUDE_BIN" -p "/camel-analysis $REPORT_TYPE" \
  --allowedTools 'Bash(*)' 'Read(*)' 'Write(*)' 'Glob(*)' 'Grep(*)' \
  >> "${LOG_DIR}/analysis-${REPORT_TYPE}.log" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] $REPORT_TYPE analysis completed."
