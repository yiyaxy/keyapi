# Mooshh KeyAPI Binary Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the current KeyAPI repository and prepare a fully verified single-node installation on `mooshh`, while leaving the final master service stopped and disabled and leaving all existing production hosts and DNS unchanged.

**Architecture:** The frontend is embedded into a statically linked Linux `amd64` Go binary. `mooshh` receives versioned releases under `/srv/keyapi`, a dedicated Redis instance on loopback port `6380`, a production-derived master environment file, a stopped final systemd unit, and an Nginx/TLS virtual host. A temporary slave-mode unit performs the only application startup during this task so PostgreSQL migrations and master-only scheduled jobs do not run.

**Tech Stack:** Windows PowerShell orchestration, Go 1.25, React/Vite, OpenSSH/SCP, Ubuntu systemd, Redis, Nginx, PostgreSQL.

## Global Constraints

- Modify only `mooshh`; access to `qysass1`, `qysass2`, and `qysass3` is read-only.
- Do not stop or restart any service on the existing production hosts.
- Do not change DNS for `token.cymoon.cn`.
- Do not start the final `NODE_TYPE=master` service on `mooshh`.
- Use `qysass2:/data/service/key-api/keyapi/.env` as the production configuration source.
- Do not print environment values, Redis passwords, database credentials, certificate private keys, or other secrets.
- Keep the existing Aegis Redis on `127.0.0.1:6379` unchanged.
- Run the KeyAPI Redis on `127.0.0.1:6380` with a unique password and separate persistence.
- Build Linux `amd64` with `CGO_ENABLED=0`; the `web-next` frontend must be embedded in the binary.
- Leave `keyapi.service` installed, stopped, and disabled at delivery.
- Leave `keyapi-redis.service` active at delivery.
- Remove the temporary preflight service and environment after validation.

---

### Task 1: Establish Baselines and Build the Release

**Files:**
- Read: `README.md`
- Read: `build.ps1`
- Create (ignored): `dist/new-api`
- Create (ignored): `web-next/dist/**`

**Interfaces:**
- Consumes: Git commit at execution time and the repository's existing build scripts.
- Produces: `dist/new-api` plus recorded commit and checksum evidence; later tasks recompute the deterministic commit-based release ID.

- [ ] **Step 1: Record local and remote baselines**

Run from `D:\top\keyapi`:

```powershell
git status --short --branch
git rev-parse HEAD
ssh mooshh "systemctl is-active nginx redis-server; ss -ltnp; df -h /; free -h"
ssh qysass1 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
ssh qysass2 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
ssh qysass3 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
```

Expected: local worktree contains only the implementation-plan file; Nginx and the existing Redis are active on `mooshh`; all three old KeyAPI services are active; port `3000` and port `6380` are free on `mooshh`.

- [ ] **Step 2: Run the repository regression suite used by the deployment guide**

```powershell
go test ./model ./middleware ./controller/partner ./controller/payment ./controller/user
```

Expected: exit code `0` with every listed package passing.

- [ ] **Step 3: Build the embedded frontend and Linux binary**

```powershell
.\build.ps1 -Arch amd64
```

Expected: `web-next/dist/index.html` and `dist/new-api` exist; the build reports Linux `amd64` success.

- [ ] **Step 4: Record the immutable release identity**

```powershell
$deploymentCommit = (git rev-parse HEAD).Trim()
$releaseId = $deploymentCommit.Substring(0, 12)
$localBinaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'dist\new-api').Hash.ToLowerInvariant()
go version -m .\dist\new-api
"release_id=$releaseId"
"binary_sha256=$localBinaryHash"
```

Expected: `go version -m` identifies a Go executable built from `github.com/QuantumNous/new-api`; the release ID contains the current commit prefix.

### Task 2: Create Auditable Deployment Configuration Artifacts

**Files:**
- Create (ignored): `dist/mooshh-deploy/keyapi.service`
- Create (ignored): `dist/mooshh-deploy/keyapi-preflight.service`
- Create (ignored): `dist/mooshh-deploy/keyapi-redis.service`
- Create (ignored): `dist/mooshh-deploy/keyapi-redis.conf`
- Create (ignored): `dist/mooshh-deploy/token.cymoon.cn.conf`

**Interfaces:**
- Consumes: target paths and ports fixed by the approved design.
- Produces: exact systemd, Redis, and Nginx files uploaded in Tasks 4-6.

- [ ] **Step 1: Create `keyapi.service` with `apply_patch`**

```ini
[Unit]
Description=KeyAPI single-node production service
After=network-online.target keyapi-redis.service
Wants=network-online.target
Requires=keyapi-redis.service

[Service]
Type=simple
User=keyapi
Group=keyapi
WorkingDirectory=/srv/keyapi/current
EnvironmentFile=/srv/keyapi/shared/keyapi.env
ExecStart=/srv/keyapi/current/new-api --port 3000 --log-dir /srv/keyapi/shared/logs
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=30
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/srv/keyapi/shared/logs

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create `keyapi-preflight.service` with `apply_patch`**

```ini
[Unit]
Description=KeyAPI mooshh slave-mode preflight
After=network-online.target keyapi-redis.service
Wants=network-online.target
Requires=keyapi-redis.service

[Service]
Type=simple
User=keyapi
Group=keyapi
WorkingDirectory=/srv/keyapi/current
EnvironmentFile=/srv/keyapi/shared/keyapi-preflight.env
ExecStart=/srv/keyapi/current/new-api --port 3000 --log-dir /srv/keyapi/shared/logs
Restart=no
KillSignal=SIGINT
TimeoutStopSec=30
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/srv/keyapi/shared/logs
```

Do not add an `[Install]` section; the preflight unit must never be enabled.

- [ ] **Step 3: Create `keyapi-redis.conf` with `apply_patch`**

```conf
bind 127.0.0.1 ::1
protected-mode yes
port 6380
tcp-backlog 511
timeout 0
tcp-keepalive 300
daemonize no
supervised no
loglevel notice
logfile ""
databases 16
dir /srv/keyapi/shared/redis
dbfilename dump.rdb
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
requirepass KEYAPI_REDIS_PASSWORD_TOKEN
maxmemory 1gb
maxmemory-policy allkeys-lru
```

- [ ] **Step 4: Create `keyapi-redis.service` with `apply_patch`**

```ini
[Unit]
Description=Dedicated Redis for KeyAPI
After=network.target

[Service]
Type=simple
User=keyapi-redis
Group=keyapi-redis
ExecStart=/usr/local/bin/redis-server /etc/redis/keyapi.conf
Restart=always
RestartSec=3
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/srv/keyapi/shared/redis

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Create `token.cymoon.cn.conf` with `apply_patch`**

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name token.cymoon.cn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name token.cymoon.cn;

    ssl_certificate /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem;
    ssl_certificate_key /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:KEYAPI_SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    client_max_body_size 100m;
    client_body_buffer_size 128k;

    location = /JxNuxhhYzJ.txt {
        default_type text/plain;
        return 200 '2978325ed86e77f14b2541f8a3ea02f0';
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
```

- [ ] **Step 6: Validate the generated artifacts contain no unresolved runtime token except the Redis password token**

```powershell
$passwordTokenMatches = @(rg -n "KEYAPI_REDIS_PASSWORD_TOKEN" dist\mooshh-deploy)
if ($passwordTokenMatches.Count -ne 1) { throw "Redis password token count is not exactly one" }
$unexpectedMarkers = @(rg -n -i "T[B]D|T[O]DO|F[I]XME|C[H]ANGE_ME" dist\mooshh-deploy)
if ($unexpectedMarkers.Count -ne 0) { $unexpectedMarkers; throw "deployment artifact contains an unresolved marker" }
```

Expected: the first command reports exactly one line in `keyapi-redis.conf`; the second command reports no matches.

### Task 3: Install the Release Layout and Binary on `mooshh`

**Files:**
- Create remotely: `/srv/keyapi/releases/$releaseId/new-api`
- Create remotely: `/srv/keyapi/current` symlink
- Create remotely: `/srv/keyapi/shared/logs/`
- Create remotely: `/srv/keyapi/shared/redis/`

**Interfaces:**
- Consumes: the current commit-derived release ID and `dist/new-api` from Task 1.
- Produces: checksum-verified `/srv/keyapi/current/new-api` owned by the `keyapi` service account.

- [ ] **Step 1: Create locked-down service ownership and directories**

```powershell
$deploymentCommit = (git rev-parse HEAD).Trim()
$releaseId = $deploymentCommit.Substring(0, 12)
ssh mooshh "id keyapi >/dev/null 2>&1 || useradd --system --home /srv/keyapi --shell /usr/sbin/nologin keyapi"
ssh mooshh "id keyapi-redis >/dev/null 2>&1 || useradd --system --home /srv/keyapi/shared/redis --shell /usr/sbin/nologin keyapi-redis"
ssh mooshh "install -d -m 0755 -o root -g root /srv/keyapi /srv/keyapi/releases; install -d -m 0750 -o keyapi -g keyapi /srv/keyapi/shared /srv/keyapi/shared/logs; install -d -m 0750 -o keyapi-redis -g keyapi-redis /srv/keyapi/shared/redis; install -d -m 0755 -o root -g root /srv/keyapi/releases/$releaseId"
```

Expected: `id keyapi` and `id keyapi-redis` succeed; release directories are root-owned; shared logs are `keyapi:keyapi`; Redis data is `keyapi-redis:keyapi-redis`.

- [ ] **Step 2: Upload the binary and set immutable release permissions**

```powershell
$deploymentCommit = (git rev-parse HEAD).Trim()
$releaseId = $deploymentCommit.Substring(0, 12)
scp .\dist\new-api "mooshh:/srv/keyapi/releases/$releaseId/new-api.upload"
ssh mooshh "chown root:root /srv/keyapi/releases/$releaseId/new-api.upload; chmod 0755 /srv/keyapi/releases/$releaseId/new-api.upload; mv /srv/keyapi/releases/$releaseId/new-api.upload /srv/keyapi/releases/$releaseId/new-api"
```

- [ ] **Step 3: Verify the remote checksum before switching `current`**

```powershell
$deploymentCommit = (git rev-parse HEAD).Trim()
$releaseId = $deploymentCommit.Substring(0, 12)
$localBinaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'dist\new-api').Hash.ToLowerInvariant()
$remoteBinaryHash = (ssh mooshh "sha256sum /srv/keyapi/releases/$releaseId/new-api | cut -d' ' -f1").Trim()
if ($remoteBinaryHash -ne $localBinaryHash) { throw "remote binary checksum mismatch" }
ssh mooshh "ln -sfn /srv/keyapi/releases/$releaseId /srv/keyapi/current"
```

Expected: the checksum comparison succeeds; `/srv/keyapi/current/new-api` resolves to the new release.

### Task 4: Install and Verify Dedicated KeyAPI Redis

**Files:**
- Create remotely: `/etc/redis/keyapi.conf`
- Create remotely: `/etc/systemd/system/keyapi-redis.service`
- Create remotely: `/srv/keyapi/shared/redis-password`

**Interfaces:**
- Consumes: Redis templates from Task 2.
- Produces: an authenticated Redis endpoint at `127.0.0.1:6380` and a protected password file consumed by Task 5.

- [ ] **Step 1: Verify the installed Redis binary supports the planned configuration**

```powershell
ssh mooshh "test -x /usr/local/bin/redis-server; /usr/local/bin/redis-server --version; getent passwd keyapi-redis"
```

Expected: `/usr/local/bin/redis-server` reports Redis 8.8.1 and the `keyapi-redis` account exists.

- [ ] **Step 2: Generate the Redis secret without printing it**

```powershell
ssh mooshh "openssl rand -hex -out /srv/keyapi/shared/redis-password 32; chown root:root /srv/keyapi/shared/redis-password; chmod 0600 /srv/keyapi/shared/redis-password"
```

- [ ] **Step 3: Upload the Redis configuration and replace the runtime token**

```powershell
scp .\dist\mooshh-deploy\keyapi-redis.conf mooshh:/etc/redis/keyapi.conf.upload
scp .\dist\mooshh-deploy\keyapi-redis.service mooshh:/etc/systemd/system/keyapi-redis.service.upload
ssh mooshh 'redis_password=$(tr -d "\r\n" </srv/keyapi/shared/redis-password); sed "s/KEYAPI_REDIS_PASSWORD_TOKEN/${redis_password}/" /etc/redis/keyapi.conf.upload >/etc/redis/keyapi.conf; install -m 0644 -o root -g root /etc/systemd/system/keyapi-redis.service.upload /etc/systemd/system/keyapi-redis.service; chown root:keyapi-redis /etc/redis/keyapi.conf; chmod 0640 /etc/redis/keyapi.conf; rm -f /etc/redis/keyapi.conf.upload /etc/systemd/system/keyapi-redis.service.upload'
```

Expected: `grep -q KEYAPI_REDIS_PASSWORD_TOKEN /etc/redis/keyapi.conf` returns nonzero; the password itself is never printed.

- [ ] **Step 4: Start Redis and run an authenticated health check**

```powershell
ssh mooshh 'systemctl daemon-reload; systemctl enable --now keyapi-redis.service; redis_password=$(tr -d "\r\n" </srv/keyapi/shared/redis-password); test "$(redis-cli -h 127.0.0.1 -p 6380 -a "$redis_password" --no-auth-warning ping)" = PONG'
```

Expected: `keyapi-redis.service` is active and authenticated ping returns success.

- [ ] **Step 5: Prove the existing Redis was not changed**

```powershell
ssh mooshh "systemctl is-active redis-server; ss -ltnp | grep -E '127.0.0.1:6379|127.0.0.1:6380'"
```

Expected: both services are active on their separate loopback ports.

### Task 5: Install the Production-Derived Environment and Final systemd Unit

**Files:**
- Read remotely: `qysass2:/data/service/key-api/keyapi/.env`
- Create remotely: `/srv/keyapi/shared/keyapi.env`
- Create remotely: `/etc/systemd/system/keyapi.service`

**Interfaces:**
- Consumes: the production master configuration and Redis password from Task 4.
- Produces: a protected final environment with `NODE_TYPE=master`, plus an installed but stopped/disabled final service.

- [ ] **Step 1: Copy the production master environment directly between hosts**

```powershell
scp -3 qysass2:/data/service/key-api/keyapi/.env mooshh:/srv/keyapi/shared/keyapi.env.source
```

Expected: the copy succeeds without displaying file contents.

- [ ] **Step 2: Apply only the approved single-node substitutions**

```powershell
ssh mooshh 'redis_password=$(tr -d "\r\n" </srv/keyapi/shared/redis-password); install -m 0600 -o keyapi -g keyapi /srv/keyapi/shared/keyapi.env.source /srv/keyapi/shared/keyapi.env; sed -i -E "s/^PORT=.*/PORT=3000/; s/^NODE_TYPE=.*/NODE_TYPE=master/; s/^SITE_LABEL=.*/SITE_LABEL=prod-single/; s#^REDIS_CONN_STRING=.*#REDIS_CONN_STRING=redis://:${redis_password}@127.0.0.1:6380/0#" /srv/keyapi/shared/keyapi.env; chown keyapi:keyapi /srv/keyapi/shared/keyapi.env; chmod 0600 /srv/keyapi/shared/keyapi.env; shred -u /srv/keyapi/shared/keyapi.env.source'
```

- [ ] **Step 3: Validate required keys and safe values without printing secrets**

```powershell
ssh mooshh 'test "$(stat -c %a /srv/keyapi/shared/keyapi.env)" = 600; grep -q "^SQL_DSN=" /srv/keyapi/shared/keyapi.env; grep -q "^SESSION_SECRET=" /srv/keyapi/shared/keyapi.env; grep -q "^CRYPTO_SECRET=" /srv/keyapi/shared/keyapi.env; grep -q "^REDIS_CONN_STRING=" /srv/keyapi/shared/keyapi.env; grep -E "^(PORT|NODE_TYPE|SITE_LABEL|DEBUG|GIN_MODE)=" /srv/keyapi/shared/keyapi.env'
```

Expected safe output includes `PORT=3000`, `NODE_TYPE=master`, `SITE_LABEL=prod-single`, `DEBUG=false`, and `GIN_MODE=release`; no secret-bearing lines are printed.

- [ ] **Step 4: Install the final service and force it into the safe delivery state**

```powershell
scp .\dist\mooshh-deploy\keyapi.service mooshh:/etc/systemd/system/keyapi.service.upload
ssh mooshh "install -m 0644 -o root -g root /etc/systemd/system/keyapi.service.upload /etc/systemd/system/keyapi.service; rm -f /etc/systemd/system/keyapi.service.upload; systemctl daemon-reload; systemctl disable --now keyapi.service"
ssh mooshh 'test "$(systemctl is-enabled keyapi.service)" = disabled; ! systemctl is-active --quiet keyapi.service'
```

Expected: `systemctl is-enabled keyapi.service` reports `disabled`; `systemctl is-active keyapi.service` reports `inactive`.

### Task 6: Install Nginx and TLS Without Changing Public Traffic

**Files:**
- Read remotely: `qysass1:/data/service/openresty/conf/cert/token.cymoon.cn.pem`
- Read remotely: `qysass1:/data/service/openresty/conf/cert/token.cymoon.cn.key`
- Create remotely: `/etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem`
- Create remotely: `/etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key`
- Create remotely: `/etc/nginx/sites-available/token.cymoon.cn`
- Create remotely: `/etc/nginx/sites-enabled/token.cymoon.cn` symlink

**Interfaces:**
- Consumes: the approved Nginx template and currently valid certificate.
- Produces: a tested HTTPS virtual host that proxies to local port `3000` when the preflight service is running.

- [ ] **Step 1: Capture the existing enabled-site health before reload**

```powershell
$existingSiteStatus = (ssh mooshh "curl -ksS -o /dev/null -w '%{http_code}' --resolve aegis-test.mooschh.com:443:127.0.0.1 https://aegis-test.mooschh.com/").Trim()
if ($existingSiteStatus -notmatch '^[1-4][0-9][0-9]$') { throw "existing Nginx site is unhealthy before deployment" }
```

- [ ] **Step 2: Copy the certificate and key directly between hosts**

```powershell
ssh mooshh "install -d -m 0755 -o root -g root /etc/nginx/ssl/token.cymoon.cn"
scp -3 qysass1:/data/service/openresty/conf/cert/token.cymoon.cn.pem mooshh:/etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem.upload
scp -3 qysass1:/data/service/openresty/conf/cert/token.cymoon.cn.key mooshh:/etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key.upload
ssh mooshh "install -m 0644 -o root -g root /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem.upload /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem; install -m 0600 -o root -g root /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key.upload /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key; rm -f /etc/nginx/ssl/token.cymoon.cn/*.upload"
```

- [ ] **Step 3: Verify certificate identity and expiry**

```powershell
ssh mooshh "openssl x509 -in /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem -noout -subject -issuer -dates -fingerprint -sha256; openssl x509 -in /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.pem -noout -checkend 86400"
```

Expected: subject contains `CN = token.cymoon.cn`; `notAfter` is 2026-10-20; `-checkend` exits `0`.

- [ ] **Step 4: Install, test, and enable the virtual host**

```powershell
scp .\dist\mooshh-deploy\token.cymoon.cn.conf mooshh:/etc/nginx/sites-available/token.cymoon.cn.upload
ssh mooshh "install -m 0644 -o root -g root /etc/nginx/sites-available/token.cymoon.cn.upload /etc/nginx/sites-available/token.cymoon.cn; rm -f /etc/nginx/sites-available/token.cymoon.cn.upload; ln -sfn /etc/nginx/sites-available/token.cymoon.cn /etc/nginx/sites-enabled/token.cymoon.cn; nginx -t; systemctl reload nginx"
```

- [ ] **Step 5: Prove the existing enabled site survived the reload**

```powershell
$existingSiteStatus = (ssh mooshh "curl -ksS -o /dev/null -w '%{http_code}' --resolve aegis-test.mooschh.com:443:127.0.0.1 https://aegis-test.mooschh.com/").Trim()
if ($existingSiteStatus -notmatch '^[1-4][0-9][0-9]$') { throw "existing Nginx site is unhealthy after reload" }
```

### Task 7: Run the Slave-Mode Application Preflight Through HTTPS

**Files:**
- Create temporarily: `/srv/keyapi/shared/keyapi-preflight.env`
- Create temporarily: `/etc/systemd/system/keyapi-preflight.service`
- Remove after validation: the two temporary files above

**Interfaces:**
- Consumes: installed binary, KeyAPI Redis, production-derived environment, final Nginx virtual host.
- Produces: manual QA evidence that the full target surface works without running migrations or master-only jobs.

- [ ] **Step 1: Create the protected slave-mode preflight environment**

```powershell
ssh mooshh "install -m 0600 -o keyapi -g keyapi /srv/keyapi/shared/keyapi.env /srv/keyapi/shared/keyapi-preflight.env; sed -i -E 's/^NODE_TYPE=.*/NODE_TYPE=slave/; s/^SITE_LABEL=.*/SITE_LABEL=mooshh-preflight/' /srv/keyapi/shared/keyapi-preflight.env"
```

- [ ] **Step 2: Install and start the temporary unit**

```powershell
scp .\dist\mooshh-deploy\keyapi-preflight.service mooshh:/etc/systemd/system/keyapi-preflight.service.upload
ssh mooshh "install -m 0644 -o root -g root /etc/systemd/system/keyapi-preflight.service.upload /etc/systemd/system/keyapi-preflight.service; rm -f /etc/systemd/system/keyapi-preflight.service.upload; systemctl daemon-reload; systemctl start keyapi-preflight.service"
```

- [ ] **Step 3: Wait for readiness with a bounded retry loop**

```powershell
ssh mooshh 'for attempt in $(seq 1 30); do if curl -fsS --max-time 2 http://127.0.0.1:3000/api/status >/dev/null; then exit 0; fi; sleep 1; done; journalctl -u keyapi-preflight.service -n 100 --no-pager; exit 1'
```

Expected: readiness succeeds within 30 seconds.

- [ ] **Step 4: Drive the direct HTTP and embedded frontend surfaces**

```powershell
$directStatus = ssh mooshh "curl -fsS http://127.0.0.1:3000/api/status"
if (-not (($directStatus | ConvertFrom-Json).success)) { throw "direct KeyAPI status is not successful" }
$directIndex = ssh mooshh "curl -fsS http://127.0.0.1:3000/"
if ($directIndex -notmatch '<!doctype html') { throw "embedded frontend did not load directly" }
```

Expected: the status assertion succeeds and the root page contains the embedded frontend document.

- [ ] **Step 5: Drive the target HTTPS surface with SNI and Host forced to `mooshh`**

```powershell
$httpsStatus = ssh mooshh "curl -fsS --resolve token.cymoon.cn:443:127.0.0.1 https://token.cymoon.cn/api/status"
if (-not (($httpsStatus | ConvertFrom-Json).success)) { throw "HTTPS KeyAPI status is not successful" }
$verificationToken = (ssh mooshh "curl -fsS --resolve token.cymoon.cn:443:127.0.0.1 https://token.cymoon.cn/JxNuxhhYzJ.txt").Trim()
if ($verificationToken -ne '2978325ed86e77f14b2541f8a3ea02f0') { throw "domain verification endpoint mismatch" }
```

Expected: HTTPS status succeeds with certificate verification enabled; the retained domain-verification endpoint returns its exact token.

- [ ] **Step 6: Prove the preflight did not run migrations or fatal initialization paths**

```powershell
ssh mooshh 'journalctl -u keyapi-preflight.service --since "10 minutes ago" --no-pager | grep -q "Redis connected"; if journalctl -u keyapi-preflight.service --since "10 minutes ago" --no-pager | grep -Eqi "database migration started|fatal|panic"; then exit 1; fi'
```

Expected: Redis connection and server startup evidence is present; `database migration started`, `FATAL`, and `panic` are absent.

- [ ] **Step 7: Stop and remove the temporary preflight artifacts**

```powershell
ssh mooshh "systemctl stop keyapi-preflight.service; rm -f /etc/systemd/system/keyapi-preflight.service /srv/keyapi/shared/keyapi-preflight.env; systemctl daemon-reload"
```

Expected: the temporary unit is absent and no KeyAPI process remains on port `3000`.

### Task 8: Verify the Safe Final Delivery State

**Files:**
- Read remotely: all installed KeyAPI, Redis, Nginx, and systemd artifacts.
- No new files.

**Interfaces:**
- Consumes: completed target installation.
- Produces: final evidence that `mooshh` is ready and the old production system is unchanged.

- [ ] **Step 1: Verify final target services and ports**

```powershell
ssh mooshh 'systemctl is-active --quiet keyapi-redis.service; systemctl is-enabled --quiet keyapi-redis.service; systemctl is-active --quiet nginx; test "$(systemctl is-enabled keyapi.service)" = disabled; ! systemctl is-active --quiet keyapi.service; ss -ltnp | grep -E "127.0.0.1:6379|127.0.0.1:6380"; if ss -ltn | grep -q ":3000 "; then exit 1; fi'
```

Expected: KeyAPI Redis and Nginx are active; `keyapi.service` is inactive and disabled; ports `6379` and `6380` listen on loopback; port `3000` is absent.

- [ ] **Step 2: Verify release, ownership, and protected configuration metadata**

```powershell
$deploymentCommit = (git rev-parse HEAD).Trim()
$releaseId = $deploymentCommit.Substring(0, 12)
$localBinaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'dist\new-api').Hash.ToLowerInvariant()
ssh mooshh "readlink -f /srv/keyapi/current; sha256sum /srv/keyapi/current/new-api; stat -c '%a %U:%G %n' /srv/keyapi/shared/keyapi.env /srv/keyapi/shared/logs /srv/keyapi/shared/redis /etc/nginx/ssl/token.cymoon.cn/token.cymoon.cn.key /etc/systemd/system/keyapi.service"
$remoteBinaryHash = (ssh mooshh "sha256sum /srv/keyapi/current/new-api | cut -d' ' -f1").Trim()
if ($remoteBinaryHash -ne $localBinaryHash) { throw "final remote binary checksum mismatch" }
$remoteRelease = (ssh mooshh 'basename "$(readlink -f /srv/keyapi/current)"').Trim()
if ($remoteRelease -ne $releaseId) { throw "final release link does not match the deployment commit" }
```

Expected: release path matches `$releaseId`; binary checksum matches `$localBinaryHash`; environment and TLS key are mode `0600`; ownership matches the design.

- [ ] **Step 3: Re-run Nginx validation in the final stopped-backend state**

```powershell
ssh mooshh "nginx -t; systemctl is-active nginx"
```

Expected: Nginx configuration is valid and active. A `502` for `token.cymoon.cn` forced to the new IP is expected after preflight stops because DNS still points to the old production gateway.

- [ ] **Step 4: Prove the old production hosts remain unchanged**

```powershell
ssh qysass1 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
ssh qysass2 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
ssh qysass3 "systemctl is-active new-api.service; sha256sum /data/service/key-api/keyapi/.env /data/service/key-api/keyapi/new-api"
```

Expected: every service remains active and all hashes equal the Task 1 baselines.

- [ ] **Step 5: Verify DNS remains unchanged**

```powershell
Resolve-DnsName -Type NS cymoon.cn
nslookup token.cymoon.cn 8.8.8.8
```

Expected: no DNS update was performed during this plan. If the local resolver returns a proxy fake IP, report that limitation and rely on the unchanged-provider assertion rather than treating the fake IP as authoritative.

- [ ] **Step 6: Reconcile local worktree state**

```powershell
git status --short --branch
```

Expected: only this implementation-plan document is uncommitted; build and deployment artifacts remain under ignored `dist/` and `web-next/dist/` paths.
