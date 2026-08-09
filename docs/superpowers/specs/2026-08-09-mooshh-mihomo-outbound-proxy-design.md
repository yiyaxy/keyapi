# mooshh Mihomo 出站代理设计

## 目标

在 `mooshh` 上运行 Mihomo，使明确使用本地代理入口的服务器命令和 KeyAPI 按规则访问网络：私有网络及中国大陆目标直连，其余目标通过用户提供的代理节点访问。

本次不启用 TUN、TPROXY 或系统默认路由接管，避免远程修改路由表或防火墙导致 SSH、Nginx、数据库连接或系统服务中断。

## 输入与保密

- 节点配置来源是用户提供的 `codex-vps-reality.yaml`。
- 节点密码、UUID、Reality 公钥及其他凭据只复制到 `mooshh`，不写入仓库、设计文档或执行日志。
- 服务器配置文件放在 `/etc/mihomo/config.yaml`，权限为 `0640 root:mihomo`。
- Mihomo 仅监听回环地址，不向公网开放代理端口或控制端口。

## 运行结构

- 二进制：`/usr/local/bin/mihomo`
- 配置目录：`/etc/mihomo`
- 运行数据目录：`/var/lib/mihomo`
- systemd unit：`mihomo.service`
- 服务用户：独立的 `mihomo` 系统用户
- 本地混合代理：`127.0.0.1:17891`，同时支持 HTTP 和 SOCKS5
- 本地控制接口：`127.0.0.1:19097`

Mihomo 使用 `rule` 模式，保留以下顺序：

1. 私有域名和私有 IP 直连。
2. 中国大陆域名和 IP 直连。
3. 其余流量进入 `PROXY` 策略组。
4. `AUTO` 在 Hysteria2 与 Reality 节点之间进行健康检查和故障切换。

配置显式加入 `bind-address: 127.0.0.1` 与 `allow-lan: false`，并校验 GeoSite/GeoIP 数据可用。

## 使用范围

### 服务器交互式命令

创建 `/etc/profile.d/mihomo-proxy.sh`，为新登录的交互式 shell 设置大小写两套变量：

- `HTTP_PROXY` / `http_proxy`
- `HTTPS_PROXY` / `https_proxy`
- `ALL_PROXY` / `all_proxy`
- `NO_PROXY` / `no_proxy`

这使 `curl`、Git、部分包管理器和其他遵循标准代理变量的命令通过 `127.0.0.1:17891` 访问网络。它不会透明接管不支持代理变量的程序。

### KeyAPI

创建 `/etc/systemd/system/keyapi.service.d/proxy.conf`，为 KeyAPI 单独设置相同的代理变量。`NO_PROXY` 至少包含：

- `127.0.0.1`
- `localhost`
- `::1`
- 当前生产 PostgreSQL 主机
- 其他从生产环境配置中识别出的内部地址

安装 drop-in 后仅执行 `systemctl daemon-reload`，不启动当前保持 `disabled/inactive` 的 KeyAPI 主服务。

## 安装流程

1. 从 Mihomo 官方发布源获取适用于 Linux amd64 的版本，并记录版本与 SHA256。
2. 创建 `mihomo` 用户、配置目录和数据目录。
3. 从用户 YAML 生成服务器配置，只增加本地绑定及运行所需配置，不改变节点凭据。
4. 使用 `mihomo -t` 校验配置。
5. 安装并启动 `mihomo.service`。
6. 通过显式 `curl --proxy` 验证国外网站可访问，并从 Mihomo 日志确认使用 `PROXY`。
7. 通过同一代理入口访问中国大陆目标，并从日志确认使用 `DIRECT`。
8. 安装 shell 代理变量和 KeyAPI systemd drop-in。
9. 重新确认 SSH、Nginx、Redis、KeyAPI 停用状态及旧生产环境均未改变。

## 故障处理

- 配置校验失败时不启动或重启 Mihomo。
- Mihomo 不可用时，移除或临时取消代理环境变量即可恢复直连；系统路由不会受到影响。
- 任一代理节点失败时由 `AUTO` 切换到另一个健康节点。
- 如果两个节点均失败，国外请求失败，但国内直连、SSH、Nginx、Redis和数据库不应受影响。

## 验收标准

- `mihomo.service` 为 `active/enabled`。
- 17891 和 19097 只监听回环地址。
- 配置文件不会被非授权用户读取。
- 国外测试请求成功且日志显示经过代理策略。
- 中国大陆测试请求成功且日志显示 `DIRECT`。
- KeyAPI systemd 配置包含代理变量和完整 `NO_PROXY`，但服务仍为 `inactive/disabled`。
- `nginx -t` 成功，现有 Nginx 与两个 Redis 服务保持运行。
- SSH 会话不依赖 Mihomo，停止 Mihomo 后 SSH 与国内服务仍可用。

## 回滚

1. 删除 KeyAPI 的代理 drop-in 并执行 `systemctl daemon-reload`。
2. 删除 `/etc/profile.d/mihomo-proxy.sh`。
3. 停止并禁用 `mihomo.service`。
4. 因未修改系统路由和防火墙，无需恢复路由表或 nftables/iptables。
