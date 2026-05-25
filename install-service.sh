#!/usr/bin/env bash
#
# install-service.sh - 一键安装 New API 为 systemd 服务
#
# 用法（在服务器上，需要 root 或 sudo）：
#   把这个脚本和 new-api 二进制、.env、new-api.service 放在同一目录
#   chmod +x install-service.sh
#   sudo ./install-service.sh
#
# 脚本会做：
#   1. 检查 new-api / .env / new-api.service 都在
#   2. 自动用当前目录路径覆盖 service 文件里的 WorkingDirectory / EnvironmentFile / ExecStart
#   3. 给二进制加执行权限、建 logs 目录
#   4. 复制 service 到 /etc/systemd/system/、enable + start
#   5. 打印状态和后续命令

set -euo pipefail

# ----- 颜色输出 -----
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
step()  { printf "\n"; cyan "==> $*"; }

# ----- 必须 root -----
if [[ $EUID -ne 0 ]]; then
    red "请用 root 或 sudo 运行：sudo ./install-service.sh"
    exit 1
fi

# ----- 找到脚本所在目录（兼容软链 + 任意 cwd）-----
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SERVICE_NAME="new-api"
SERVICE_FILE_SRC="$APP_DIR/${SERVICE_NAME}.service"
SERVICE_FILE_DST="/etc/systemd/system/${SERVICE_NAME}.service"
BIN="$APP_DIR/${SERVICE_NAME}"
ENV_FILE="$APP_DIR/.env"
LOG_DIR="$APP_DIR/logs"

step "检查文件"
for f in "$BIN" "$ENV_FILE" "$SERVICE_FILE_SRC"; do
    if [[ ! -f "$f" ]]; then
        red "缺少文件：$f"
        exit 1
    fi
done
green "  应用目录：$APP_DIR"

# ----- 准备权限 + 日志目录 -----
step "设置权限和日志目录"
chmod +x "$BIN"
mkdir -p "$LOG_DIR"
green "  $BIN（已加执行权限）"
green "  $LOG_DIR"

# ----- 改写 service 文件路径，写到 /etc/systemd/system/ -----
step "生成 systemd unit"

# 用 # 当 sed 分隔符，避免路径里的 / 冲突
sed -e "s#^WorkingDirectory=.*#WorkingDirectory=${APP_DIR}#" \
    -e "s#^EnvironmentFile=.*#EnvironmentFile=${ENV_FILE}#" \
    -e "s#^ExecStart=.*#ExecStart=${BIN} --port 3000 --log-dir ${LOG_DIR}#" \
    "$SERVICE_FILE_SRC" > "$SERVICE_FILE_DST"

chmod 644 "$SERVICE_FILE_DST"
green "  写入：$SERVICE_FILE_DST"
echo "----- unit 内容 -----"
cat "$SERVICE_FILE_DST"
echo "---------------------"

# ----- 启动服务 -----
step "启动服务"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2

# ----- 检查状态 -----
step "服务状态"
if systemctl is-active --quiet "$SERVICE_NAME"; then
    green "  $SERVICE_NAME 正在运行"
    systemctl status "$SERVICE_NAME" --no-pager -l | head -n 15
else
    red "  $SERVICE_NAME 启动失败，请看下面日志："
    systemctl status "$SERVICE_NAME" --no-pager -l | head -n 30
    echo
    red "  也可以查实时日志："
    echo "    sudo journalctl -u $SERVICE_NAME -f"
    exit 1
fi

# ----- 后续提示 -----
echo
cyan "常用命令："
echo "  实时日志：   sudo journalctl -u $SERVICE_NAME -f"
echo "  查看状态：   sudo systemctl status $SERVICE_NAME"
echo "  重启：       sudo systemctl restart $SERVICE_NAME"
echo "  停止：       sudo systemctl stop $SERVICE_NAME"
echo "  禁用自启：   sudo systemctl disable $SERVICE_NAME"
echo "  健康检查：   curl -s http://localhost:3000/api/status"
