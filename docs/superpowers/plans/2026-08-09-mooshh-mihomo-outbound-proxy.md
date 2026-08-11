# mooshh Mihomo Outbound Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `mooshh` 安装仅监听回环地址的 Mihomo，使交互式服务器命令和 KeyAPI 按“中国大陆直连、其他目标代理”的规则出站，同时保持 SSH 和现有服务不受系统路由变更影响。

**Architecture:** Mihomo 作为独立 systemd 服务提供 `127.0.0.1:17891` mixed proxy，并使用用户提供的两条节点配置和现有 GeoSite/GeoIP 规则。交互式 shell 与 KeyAPI 通过标准代理环境变量显式接入；不启用 TUN、TPROXY、iptables/nftables 或默认路由接管。

**Tech Stack:** Mihomo stable Linux amd64 compatible binary、systemd、Clash/Mihomo YAML、HTTP/SOCKS5、PowerShell/SSH/SCP

## Global Constraints

- 只修改 `mooshh`；`qysass1`、`qysass2`、`qysass3` 只允许只读验证。
- 不启动当前 `disabled/inactive` 的 `keyapi.service`。
- 不修改 DNS、Nginx 路由、系统默认路由或防火墙。
- 节点密码、UUID、公钥和 short-id 不得写入仓库、计划、命令输出或最终回复。
- `/etc/mihomo/config.yaml` 必须为 `0640 root:mihomo`。
- 17891 与 19097 只能监听 `127.0.0.1`。
- 用户提供的源 YAML 通过 SCP 直接传到 `mooshh`，不在仓库内复制或编辑。

---

### Task 1: 记录基线并取得官方稳定版 Mihomo

**Files:**
- Read: `D:/soft/weixin_chat/xwechat_files/wxid_rd4aqa34ap9n22_eba5/temp/RWTemp/2026-08/2d624a79a6e52d632260d27ecb79c805/codex-vps-reality.yaml`
- Create ignored: `dist/mooshh-mihomo/mihomo-release.json`
- Create ignored: `dist/mooshh-mihomo/mihomo-linux-amd64-compatible.gz`

**Interfaces:**
- Consumes: GitHub official release API `https://api.github.com/repos/MetaCubeX/mihomo/releases/latest`.
- Produces: stable version, asset URL, official SHA256 digest, and a verified compressed artifact.

- [ ] **Step 1: Record target baseline**

Run:

```powershell
ssh mooshh 'set -e; uname -m; systemctl is-active nginx redis-server keyapi-redis; printf "keyapi=%s/%s\n" "$(systemctl is-active keyapi.service 2>/dev/null || true)" "$(systemctl is-enabled keyapi.service 2>/dev/null || true)"; ss -ltnp | grep -E ":(17891|19097|3000|6379|6380)\\b" || true; command -v mihomo || true'
```

Expected: `x86_64`; Nginx and both Redis services active; KeyAPI inactive/disabled; 17891 and 19097 free.

- [ ] **Step 2: Query the official latest stable release**

Run PowerShell against the GitHub API, select exactly one asset matching `^mihomo-linux-amd64-compatible-v.*\.gz$`, and save only non-secret release metadata under ignored `dist/mooshh-mihomo/`.

Expected: release is not prerelease/draft; asset exposes a `sha256:` digest.

- [ ] **Step 3: Download and verify the compressed artifact**

Run:

```powershell
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile '.\dist\mooshh-mihomo\mihomo-linux-amd64-compatible.gz'
$actual = (Get-FileHash -Algorithm SHA256 '.\dist\mooshh-mihomo\mihomo-linux-amd64-compatible.gz').Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Mihomo checksum mismatch" }
```

Expected: local digest equals the official release asset digest.

---

### Task 2: 生成并校验服务器配置与 systemd unit

**Files:**
- Create ignored: `dist/mooshh-mihomo/mihomo.service`
- Create ignored: `dist/mooshh-mihomo/mihomo-proxy.sh`
- Create ignored: `dist/mooshh-mihomo/keyapi-proxy.conf.template`
- Create remote: `/etc/mihomo/config.yaml`

**Interfaces:**
- Consumes: user YAML and verified Mihomo binary.
- Produces: loopback-only configuration, hardened service unit, shell environment file, and KeyAPI drop-in template.

- [ ] **Step 1: Create the hardened Mihomo unit**

Use this unit content:

```ini
[Unit]
Description=Mihomo outbound proxy for mooshh
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mihomo
Group=mihomo
Environment=HOME=/var/lib/mihomo
ExecStart=/usr/local/bin/mihomo -d /var/lib/mihomo -f /etc/mihomo/config.yaml
Restart=always
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=/etc/mihomo
ReadWritePaths=/var/lib/mihomo

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create the shell proxy file**

Use loopback port 17891 for uppercase and lowercase HTTP/HTTPS/ALL proxy variables. Set uppercase and lowercase `NO_PROXY` to `127.0.0.1,localhost,::1` plus a token replaced remotely with the production database hostname.

- [ ] **Step 3: Create the KeyAPI drop-in template**

Use systemd `Environment=` entries for the same uppercase/lowercase variables. Keep the database host as `KEYAPI_DB_HOST_TOKEN` until remote installation.

- [ ] **Step 4: Transfer the source YAML directly and enforce permissions**

Run:

```powershell
ssh mooshh 'install -d -m 0755 -o root -g root /etc/mihomo; install -d -m 0750 -o mihomo -g mihomo /var/lib/mihomo'
scp 'D:\soft\weixin_chat\xwechat_files\wxid_rd4aqa34ap9n22_eba5\temp\RWTemp\2026-08\2d624a79a6e52d632260d27ecb79c805\codex-vps-reality.yaml' 'mooshh:/etc/mihomo/config.yaml.upload'
ssh mooshh 'chown root:mihomo /etc/mihomo/config.yaml.upload; chmod 0640 /etc/mihomo/config.yaml.upload'
```

- [ ] **Step 5: Add explicit loopback binding without printing secrets**

Validate that `mixed-port`, `allow-lan`, `mode`, `external-controller`, both proxy names, both groups, and all five routing rules exist. Insert the following top-level settings after `allow-lan`, then install atomically as `/etc/mihomo/config.yaml`:

```yaml
bind-address: 127.0.0.1
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24
geox-url:
  geoip: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
  geosite: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
```

Expected: credentials remain present but are never printed; config mode is `0640 root:mihomo`.

---

### Task 3: 安装并启动 Mihomo

**Files:**
- Create remote: `/usr/local/bin/mihomo`
- Create remote: `/etc/systemd/system/mihomo.service`
- Create remote: `/var/lib/mihomo/geosite.dat`
- Create remote: `/var/lib/mihomo/geoip.dat`

**Interfaces:**
- Consumes: verified compressed binary and target configuration.
- Produces: `mihomo.service` active/enabled and loopback proxy/control ports.

- [ ] **Step 1: Upload and decompress the verified binary**

Upload the `.gz`, decompress to a temporary target file, install it as root-owned mode `0755`, and verify `mihomo -v` reports the selected stable version.

- [ ] **Step 2: Validate configuration before service installation**

Run:

```bash
/usr/local/bin/mihomo -t -d /var/lib/mihomo -f /etc/mihomo/config.yaml
```

If the initial validation cannot download Geo data, download the two configured jsDelivr URLs on the local workstation, upload them as `/var/lib/mihomo/geosite.dat.upload` and `/var/lib/mihomo/geoip.dat.upload`, install both as `0644 mihomo:mihomo`, and repeat validation.

- [ ] **Step 3: Install and verify the unit**

Run `systemd-analyze verify` before `systemctl daemon-reload`. Do not start on a failed validation.

- [ ] **Step 4: Enable and start Mihomo**

Run `systemctl enable --now mihomo.service`, then assert service active/enabled and both ports bound only to loopback.

---

### Task 4: 驱动国内直连与国外代理路径

**Files:**
- Read remote: Mihomo journal and local controller API.

**Interfaces:**
- Consumes: active loopback Mihomo proxy.
- Produces: runtime evidence for DIRECT, PROXY, and node health.

- [ ] **Step 1: Validate foreign traffic**

Run a bounded request through `http://127.0.0.1:17891` to `https://www.gstatic.com/generate_204` and require HTTP 204.

- [ ] **Step 2: Validate domestic traffic**

Run a bounded request through the same proxy to `https://www.baidu.com/` and require an HTTP response in the 1xx-4xx range.

- [ ] **Step 3: Confirm routing decisions from fresh logs**

Sanitize any credential-shaped strings, then assert the foreign request matched `PROXY`/`AUTO` and the mainland request matched `DIRECT`.

- [ ] **Step 4: Verify both nodes are represented in AUTO health state**

Query `http://127.0.0.1:19097/proxies/AUTO`; assert both configured node names are present and at least one usable path completes the foreign request.

---

### Task 5: 配置交互式 shell 与 KeyAPI

**Files:**
- Create remote: `/etc/profile.d/mihomo-proxy.sh`
- Create remote: `/etc/systemd/system/keyapi.service.d/proxy.conf`

**Interfaces:**
- Consumes: local proxy endpoint and database hostname derived privately from `/srv/keyapi/shared/keyapi.env`.
- Produces: explicit proxy environment for future login shells and KeyAPI without starting KeyAPI.

- [ ] **Step 1: Derive and validate the database hostname without printing the DSN**

Extract the hostname from `SQL_DSN` with the following remote logic; assert it is non-empty and contains neither `/`, `:`, `@` nor whitespace. Do not echo the DSN or hostname in normal output.

```bash
sql_dsn=$(sed -n 's/^SQL_DSN=//p' /srv/keyapi/shared/keyapi.env)
db_host=$(printf '%s' "$sql_dsn" | sed -E 's#^.*@##; s#[:/?].*$##')
test -n "$db_host"
! printf '%s' "$db_host" | grep -qE '[/@:[:space:]]'
```

- [ ] **Step 2: Install the shell proxy file**

Replace `KEYAPI_DB_HOST_TOKEN`, install mode `0644 root:root`, and validate with a new login shell that proxy variables point to loopback and `NO_PROXY` contains the database host.

- [ ] **Step 3: Install the KeyAPI systemd drop-in**

Install mode `0644 root:root`, run `systemctl daemon-reload`, and assert `systemctl show keyapi.service -p Environment` contains loopback proxy endpoints without printing unrelated environment secrets.

- [ ] **Step 4: Preserve KeyAPI safe state**

Assert `keyapi.service` remains inactive/disabled and port 3000 remains closed.

---

### Task 6: 最终安全验收

**Files:**
- Read: local worktree status and all installed target artifacts.

**Interfaces:**
- Consumes: completed installation.
- Produces: evidence-backed handoff and rollback-ready state.

- [ ] **Step 1: Re-run Mihomo config and service verification**

Require config test success, service active/enabled, correct binary version, correct config permissions, and loopback-only ports.

- [ ] **Step 2: Re-run real proxy requests**

Require foreign HTTP 204 and mainland HTTP 1xx-4xx through a fresh login shell using the installed environment variables.

- [ ] **Step 3: Verify existing mooshh services**

Require `nginx -t`; Nginx, existing Redis 6379, and KeyAPI Redis 6380 active; KeyAPI inactive/disabled; no listener on 3000.

- [ ] **Step 4: Verify rollback isolation**

Confirm no TUN device, no Mihomo routing-table rule, and no Mihomo-created iptables/nftables rule exists.

- [ ] **Step 5: Verify local repository hygiene**

Run `git status --short` and confirm no secret-containing file is tracked or untracked outside ignored `dist/`; report the already-existing untracked KeyAPI deployment plan separately.
