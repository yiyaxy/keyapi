# Direct-run production cluster

This guide is for running KeyAPI directly on the host, without Docker.

## Target topology

```text
Nginx or Caddy
  -> keyapi@master  :3001  NODE_TYPE=master
  -> keyapi@slave-1 :3002  NODE_TYPE=slave

Shared services:
  PostgreSQL or MySQL
  Redis
```

Use one master node and one or more slave nodes. The master runs migrations and
scheduled jobs. Slaves serve traffic but should not run master-only jobs.

## Files added for this deployment

- `.env.production.master.example`
- `.env.production.slave.example`
- `docs/examples/keyapi@.service`
- `docs/examples/nginx-keyapi-cluster.conf`

The real secret files should live outside the repository, for example:

```bash
/opt/keyapi/config/keyapi-master.env
/opt/keyapi/config/keyapi-slave-1.env
```

## Prepare secrets

Generate stable secrets and reuse them on every node:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Use the generated values for:

- `SESSION_SECRET`
- `CRYPTO_SECRET`
- `PROMETHEUS_TOKEN`

`SESSION_SECRET` and `CRYPTO_SECRET` must be exactly the same on master and
slaves. Changing them later invalidates sessions or signed links.

## Prepare PostgreSQL

Create a production database and user. Example:

```sql
CREATE USER keyapi WITH PASSWORD 'CHANGE_ME_DB_PASSWORD';
CREATE DATABASE keyapi OWNER keyapi;
GRANT ALL PRIVILEGES ON DATABASE keyapi TO keyapi;
```

Recommended first capacity setting for a two-node cluster:

```text
max_connections = 300
shared_buffers = 25% of RAM
work_mem = 16MB
maintenance_work_mem = 256MB
effective_cache_size = 60% to 70% of RAM
```

Keep the total app connection budget below the database limit:

```text
total_connections = node_count * SQL_MAX_OPEN_CONNS
```

For two nodes, the included templates use `120 * 2 = 240`, leaving room for
maintenance connections.

## Prepare Redis

Redis is required for multi-node production. It shares rate-limit state and
cache invalidation messages across nodes.

Minimum recommended Redis config:

```text
requirepass CHANGE_ME_REDIS_PASSWORD
appendonly yes
maxmemory 1gb
maxmemory-policy allkeys-lru
```

Use the same `REDIS_CONN_STRING` on every node:

```env
REDIS_CONN_STRING=redis://:CHANGE_ME_REDIS_PASSWORD@127.0.0.1:6379/0
```

## Install the binary

Build the web frontend first, then the backend binary:

```bash
cd /opt/keyapi/current
cd web-next
npm install
npm run build
cd ..
go build -o new-api main.go
```

Create a locked-down runtime user:

```bash
sudo useradd --system --home /opt/keyapi --shell /usr/sbin/nologin keyapi
sudo mkdir -p /opt/keyapi/config /var/log/keyapi/master /var/log/keyapi/slave-1
sudo chown -R keyapi:keyapi /opt/keyapi /var/log/keyapi
```

## Configure node env files

Copy and edit the templates:

```bash
sudo cp .env.production.master.example /opt/keyapi/config/keyapi-master.env
sudo cp .env.production.slave.example /opt/keyapi/config/keyapi-slave-1.env
sudo chmod 600 /opt/keyapi/config/keyapi-*.env
sudo chown keyapi:keyapi /opt/keyapi/config/keyapi-*.env
```

Important differences:

- master: `PORT=3001`, `NODE_TYPE=master`, `CHANNEL_UPDATE_FREQUENCY=30`
- slave: `PORT=3002`, `NODE_TYPE=slave`, no `CHANNEL_UPDATE_FREQUENCY`
- all nodes: same `SQL_DSN`, `REDIS_CONN_STRING`, `SESSION_SECRET`,
  `CRYPTO_SECRET`

## Install systemd units

```bash
sudo cp docs/examples/keyapi@.service /etc/systemd/system/keyapi@.service
sudo systemctl daemon-reload
sudo systemctl enable --now keyapi@master
sudo systemctl enable --now keyapi@slave-1
```

Check status:

```bash
sudo systemctl status keyapi@master
sudo systemctl status keyapi@slave-1
curl http://127.0.0.1:3001/api/status
curl http://127.0.0.1:3002/api/status
```

## Install Nginx

Copy the example and replace `api.example.com`:

```bash
sudo cp docs/examples/nginx-keyapi-cluster.conf /etc/nginx/conf.d/keyapi.conf
sudo nginx -t
sudo systemctl reload nginx
```

The example disables proxy buffering so streaming responses work correctly.

## Scale out

For another slave:

1. Copy `/opt/keyapi/config/keyapi-slave-1.env` to
   `/opt/keyapi/config/keyapi-slave-2.env`.
2. Change `PORT=3003` and `SITE_LABEL=prod-slave-2`.
3. Start it with `sudo systemctl enable --now keyapi@slave-2`.
4. Add `server 127.0.0.1:3003;` to the Nginx upstream.
5. Lower per-node `SQL_MAX_OPEN_CONNS` if the database connection budget is
   getting tight.

## Production checklist

- Real `.env.*` files are outside the repo and chmod `600`.
- Only one node uses `NODE_TYPE=master`.
- All nodes share the same `SESSION_SECRET` and `CRYPTO_SECRET`.
- Redis is reachable from every node.
- Database max connections exceed `node_count * SQL_MAX_OPEN_CONNS`.
- Nginx has long read timeouts and `proxy_buffering off`.
- `DEBUG=false`, `GIN_MODE=release`, `ENABLE_PPROF=false`.
- Upstream model channel RPM/TPM is sized for your user traffic.
- Run a load test before public launch.
