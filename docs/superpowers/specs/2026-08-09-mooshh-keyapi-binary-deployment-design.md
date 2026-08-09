# Mooshh KeyAPI Binary Deployment Design

## Goal

Prepare `mooshh` as a complete, verified single-node KeyAPI host using the current repository build, while leaving the existing production nodes, gateway, and DNS unchanged.

The delivered host must be ready for a later cutover, but its production KeyAPI service must remain stopped and disabled so it cannot run master-only migrations or scheduled jobs alongside the existing production master.

## Scope

### In scope

- Build the current repository for Linux `amd64` with the `web-next` frontend embedded in the Go binary.
- Install the release on `mooshh` under a versioned, rollback-friendly directory layout.
- Copy the actual production master configuration from `qysass2` to `mooshh` without printing secrets.
- Convert that configuration from the current clustered topology to the future single-node topology.
- Install a dedicated local Redis instance for KeyAPI.
- Install a systemd service for the future KeyAPI master.
- Install an Nginx virtual host and the currently valid `token.cymoon.cn` certificate on `mooshh`.
- Run a temporary slave-mode preflight instance and verify the application through both its direct HTTP endpoint and the target Nginx HTTPS endpoint.
- Stop the preflight instance and leave the final master service stopped and disabled.

### Out of scope

- Stopping or modifying KeyAPI on `qysass1`, `qysass2`, or `qysass3`.
- Modifying the old OpenResty/Nginx gateway on `qysass1`.
- Changing DNS for `token.cymoon.cn`.
- Starting or enabling the final master service on `mooshh`.
- Migrating historical application logs.
- Migrating Redis keys from the existing cluster.
- Restoring or modifying PostgreSQL data.

## Current Production Facts

- `token.cymoon.cn` currently enters through OpenResty on `qysass1`.
- The gateway balances traffic to:
  - `qysass2` / `192.168.0.202:3001`, `NODE_TYPE=master`
  - `qysass3` / `192.168.0.32:3002`, `NODE_TYPE=slave`
- The production database is an external PostgreSQL 18.3 database named `keyapi`, approximately 538 MB.
- Both production nodes use the same binary and share Redis through a private-network endpoint.
- `mooshh` is Ubuntu Linux on `x86_64`, runs systemd and Nginx, and has sufficient free CPU, memory, and disk capacity.
- Port `3000` is currently available on `mooshh`.
- The target host already runs another Redis service for Aegis; KeyAPI must not share or reconfigure it.
- The existing `token.cymoon.cn` certificate is valid through 2026-10-20.

## Target Architecture

```text
token.cymoon.cn (DNS remains unchanged during this task)
  -> mooshh Nginx :443
  -> KeyAPI 127.0.0.1:3000
  -> existing external PostgreSQL
  -> dedicated KeyAPI Redis 127.0.0.1:6380
```

The Nginx configuration is installed and tested on `mooshh`, but normal public traffic will continue to reach the old gateway until a later DNS cutover.

## Release Layout

```text
/srv/keyapi/
|-- current -> releases/<release-id>
|-- releases/
|   `-- <release-id>/
|       `-- new-api
`-- shared/
    |-- keyapi.env
    |-- logs/
    `-- redis/
```

- `<release-id>` identifies the deployment using a timestamp and the current Git commit.
- `current` is updated atomically only after the uploaded binary checksum matches the local build.
- The final environment file is mode `0600` and readable only by the KeyAPI service account.
- Logs and Redis persistence live outside release directories so a later binary rollback does not discard runtime state.

## Application Configuration

The source of truth is the active production master environment file on `qysass2`, not the unused local service configuration on `qysass1`.

The file is transferred without displaying its values. The following settings are changed on `mooshh`:

```text
PORT=3000
NODE_TYPE=master
SITE_LABEL=prod-single
REDIS_CONN_STRING=redis://:<generated-password>@127.0.0.1:6380/0
```

Database settings, session and encryption secrets, payment settings, rate limits, timeouts, and other business configuration remain unchanged.

## Dedicated Redis

KeyAPI receives an independent Redis instance with these properties:

- Bound only to `127.0.0.1:6380`.
- Protected by a newly generated random password.
- Append-only persistence enabled.
- Data stored under `/srv/keyapi/shared/redis`.
- A memory ceiling of 1 GB with `allkeys-lru` eviction.
- Managed by a dedicated `keyapi-redis.service` unit.

Existing Redis data is not copied. Current KeyAPI usage is cache, rate-limit counters, short-lived authentication state, and multi-node invalidation. PostgreSQL remains the durable source for business data and quota state. The new single node will warm its caches from PostgreSQL; minute-level counters start fresh at the later cutover.

## systemd Services

### Final service

`keyapi.service` uses:

- `User=keyapi` and `Group=keyapi`
- `WorkingDirectory=/srv/keyapi/current`
- `EnvironmentFile=/srv/keyapi/shared/keyapi.env`
- `ExecStart=/srv/keyapi/current/new-api --port 3000 --log-dir /srv/keyapi/shared/logs`
- automatic restart on failure
- filesystem hardening with explicit write access only to KeyAPI shared paths

The unit is installed and daemon-reloaded but remains stopped and disabled at delivery.

### Preflight service

A temporary `keyapi-preflight.service` uses a protected copy of the environment with:

```text
NODE_TYPE=slave
PORT=3000
SITE_LABEL=mooshh-preflight
```

Slave mode connects to PostgreSQL but returns before schema migration and skips master-only scheduled work. The temporary service is never enabled and is removed after validation.

## Nginx and TLS

- Copy the current `token.cymoon.cn` certificate and private key from `qysass1` to a dedicated directory on `mooshh`.
- Store the certificate as mode `0644` and the private key as mode `0600`.
- Add a `token.cymoon.cn` server block to the existing Nginx installation.
- Redirect HTTP to HTTPS.
- Proxy HTTPS to `127.0.0.1:3000`.
- Disable response and request buffering for streaming model responses.
- Preserve WebSocket upgrade headers and forwarded client headers.
- Allow request bodies up to 100 MB and upstream reads up to 600 seconds.
- Run `nginx -t` before reloading Nginx so existing virtual hosts are not disrupted by an invalid configuration.

The existing certificate is sufficient for preflight. Automated certificate renewal is deferred until the later DNS cutover because ACME validation must resolve to `mooshh`.

## Deployment Sequence

1. Verify the local Git worktree and record the exact commit.
2. Build `web-next`, then cross-compile the Go binary for Linux `amd64` with `CGO_ENABLED=0`.
3. Verify the build artifact locally and calculate its SHA-256 checksum.
4. Create the `keyapi` system account and target directories on `mooshh`.
5. Install and start the dedicated KeyAPI Redis service, then verify it with an authenticated ping.
6. Transfer the production master environment from `qysass2`, apply only the documented single-node changes, and enforce mode `0600`.
7. Upload the binary to a new release directory, verify its remote checksum, and atomically point `current` to the release.
8. Install the final stopped/disabled `keyapi.service`.
9. Install the certificate, private key, and Nginx virtual host; validate and reload Nginx.
10. Create and start the temporary slave-mode preflight service.
11. Run the validation scenarios below.
12. Stop and remove the preflight service and environment file.
13. Confirm the final `keyapi.service` is stopped and disabled and that no process is listening on port `3000`.

## Validation

### Binary and dependencies

- Remote SHA-256 equals the local build checksum.
- The Linux binary is executable by the `keyapi` service account.
- The final environment file has mode `0600` and contains all expected variable names.

### Redis

- `keyapi-redis.service` is active.
- Authenticated `PING` returns `PONG` on `127.0.0.1:6380`.
- The existing Aegis Redis remains active and unchanged on `127.0.0.1:6379`.

### Application preflight

- The slave-mode service reaches PostgreSQL and Redis successfully.
- `GET http://127.0.0.1:3000/api/status` returns `success=true`.
- The embedded frontend index loads successfully.
- Startup logs contain no fatal database, Redis, or configuration errors.
- Logs do not report a database migration because preflight runs as slave.

### Nginx and TLS

- `nginx -t` succeeds.
- A request forced to the `mooshh` IP with SNI and Host `token.cymoon.cn` returns the KeyAPI status response over HTTPS.
- Streaming proxy headers and timeouts are present in the installed virtual host.
- Existing Nginx-hosted applications remain healthy after reload.

### Final delivery state

- `keyapi.service` is installed, stopped, and disabled.
- `keyapi-preflight.service` no longer exists.
- Port `3000` is not listening.
- `keyapi-redis.service` remains active for readiness.
- No files or services on `qysass1`, `qysass2`, or `qysass3` were modified.
- DNS for `token.cymoon.cn` remains unchanged.

## Failure Handling

- A build failure stops the deployment before any target changes.
- A Redis, database, or preflight failure leaves the final master service stopped.
- A failed Nginx configuration test prevents reload and preserves the existing active configuration.
- A failed application preflight leaves the uploaded release and logs available for diagnosis, but no master process is started.
- Because this task does not change production traffic, rollback consists of leaving `keyapi.service` stopped and removing or correcting only the failed target-side configuration in a later repair step.

## Success Criteria

The task is complete when `mooshh` contains a checksum-verified current KeyAPI binary, protected production-derived configuration, dedicated Redis, final systemd service, and tested Nginx/TLS configuration; the full application has passed a slave-mode preflight through HTTPS; the final master service is stopped and disabled; and all old production hosts and DNS remain untouched.
