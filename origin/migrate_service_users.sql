-- PostgreSQL migration generated from origin/users.sql and origin/tokens.sql
-- Scope: migrate ordinary users only (users.role = 1) whose old users."group" = 'service'.
-- Includes tokens whose old user_id belongs to those users.
-- Generated at: 2026-04-28T13:49:29
-- Selected users: 10; selected tokens: 11.
-- Target tenant_id: 1 (Default tenant).

BEGIN;

CREATE TEMP TABLE __migrate_service_users (
  old_id integer PRIMARY KEY,
  username text NOT NULL,
  password text NOT NULL,
  display_name text,
  role integer NOT NULL,
  status integer NOT NULL,
  email text,
  github_id text,
  discord_id text,
  oidc_id text,
  wechat_id text,
  telegram_id text,
  access_token text,
  quota integer,
  used_quota integer,
  request_count integer,
  "group" text,
  aff_code text,
  aff_count integer,
  aff_quota integer,
  aff_history integer,
  inviter_id integer,
  deleted_at timestamptz,
  linux_do_id text,
  setting text,
  remark text,
  stripe_customer text
) ON COMMIT DROP;

INSERT INTO __migrate_service_users (old_id, username, password, display_name, role, status, email, github_id, discord_id, oidc_id, wechat_id, telegram_id, access_token, quota, used_quota, request_count, "group", aff_code, aff_count, aff_quota, aff_history, inviter_id, deleted_at, linux_do_id, setting, remark, stripe_customer) VALUES
  (4, 'customer_system', '$2a$10$BciC5eoqXkEhwyQ8v03b/.kxdisJXW/UiCOVjPmzUxIHTH7MjTRlK', '客服系统', 1, 1, '', '', '', '', '', '', NULL, 1604654, 2008063, 55, 'service', 'HJ6B', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}","language":"zh-CN"}', '', ''),
  (6, 'jiaservice', '$2a$10$9iceukh2M1i19/XopFYeau/XTPNL/JCM9E6nQFkSQqerK3onUy5tW', 'jiaservice', 1, 1, '', '', '', '', '', '', NULL, 7181060, 44474, 11, 'service', 'ATlk', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (2, 'service_moxing', '$2a$10$cuqrsYa//4hanjLTdWpo3OwUWYkIs.LrPk7ktFORApJgcdyMXaFvC', '账号1', 1, 1, '', '', '', '', '', '', 'ZetufhSfYQTJ1N3vFVyIhrpyMUeAvg==', 12930877, 7214464, 336, 'service', 'Jzon', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}","language":"zh-CN"}', '', ''),
  (3, 'heibai', '$2a$10$xBzoamZtqf66bnpC1Cotx.KcjfftGkhNB.1JI8J8YA3z2rNMOBtC.', 'heibai', 1, 1, '', '', '', '', '', '', NULL, 7125582, 99852, 49, 'service', '1mRj', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (26, 'qianservice', '$2a$10$.M8.sh7No4jYoX4m4VmNaOGAxs/4QX85X1CpT7wSvrIX1s9DTo5Wm', 'qianservice', 1, 1, '', '', '', '', '', '', NULL, 59664039, 12590296, 721, 'service', 'FmmQ', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (17, 'atservice', '$2a$10$MLg3.NaORJRUvXwaUmPx3.mmcr5yIgH5pse9BH1IFjORrwsnJElPu', 'at', 1, 1, '', '', '', '', '', '', NULL, 7742, 15165668, 707, 'service', 'Jjw0', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (7, 'maservice', '$2a$10$0R8ummcf3XKbG40WHFINnuDOAihL0TPFI48XS6bpPh2.tVH6U2RLq', 'maservice', 1, 1, '', '', '', '', '', '', NULL, -4406, 28923482, 508, 'service', 'B30I', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (16, '19857019796', '$2a$10$4MiwKoDktSd1D.S9i/tbhe3wECgdsWtlLqDcNPG64STCD5HHhiGVi', '糖', 1, 1, '', '', '', '', '', '', NULL, 1825013, 23174987, 850, 'service', 'Qkjr', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (30, 'mingyu', '$2a$10$OfN/qs8yvYWNali.5uAi5et58NgyvORsxOzM6ACHb1jBz6W4VqAHS', 'mingyu', 1, 1, '', '', '', '', '', '', NULL, 3548562, 64155, 12, 'service', 'h2mn', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', ''),
  (27, 'doctorsevice', '$2a$10$.A0JcducCZRvZ.lrU.iUZ.Hz.hwA0rAtrKW6GtZCGwobSDSPHZ9g.', 'doctorsevice', 1, 1, '', '', '', '', '', '', NULL, 58797, 21617504, 1184, 'service', 'Fm70', 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '');

CREATE TEMP TABLE __migrate_service_tokens (
  old_id integer PRIMARY KEY,
  old_user_id integer NOT NULL,
  "key" text NOT NULL,
  status integer NOT NULL,
  name text,
  created_time bigint,
  accessed_time bigint,
  expired_time bigint,
  remain_quota integer,
  unlimited_quota boolean,
  model_limits_enabled boolean,
  model_limits text,
  allow_ips text,
  used_quota integer,
  "group" text,
  cross_group_retry boolean,
  deleted_at timestamptz
) ON COMMIT DROP;

INSERT INTO __migrate_service_tokens (old_id, old_user_id, "key", status, name, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, allow_ips, used_quota, "group", cross_group_retry, deleted_at) VALUES
  (8, 6, 'CgdNJpro8NrL34YksNdkKSJR8wzakUGGMRpc5BU7Cp1VuZAp', 1, 'jiaservice', 1773910009, 1773911290, -1, -44474, 't', 'f', '', '', 44474, 'service', 'f', NULL),
  (1, 2, 'bZnVeILl82T8jyqheOoI5Y07f6uHrxWDbrVbeGMgtnpEUfvC', 1, '测试', 1772605413, 1773286057, -1, -2976003, 't', 'f', '', '', 2976003, 'service', 'f', NULL),
  (10, 2, 'oCUFpsF4BcesQTblWy59BDvwtfW9XaNoGY8ixpFny30BvOPP', 1, 'FELIX', 1774328519, 1774495803, -1, -1041165, 't', 'f', '', '', 1041165, '', 'f', NULL),
  (5, 4, 'WBiAngKdm55FyvEFap6EXXyk4GzwWWkBrEZo6S0id2VnoJde', 1, '客服', 1773406541, 1773412114, -1, -2008063, 't', 'f', '', '', 2008063, '', 'f', NULL),
  (2, 2, 'GOLW7cXKmCgSvHWpwhe9xl0CgK3bjCxH5ksfzM3kv1UlJj8r', 1, 'service', 1773029326, 1773416030, -1, -3374336, 't', 't', 'gpt-5.4', '', 3374336, 'service', 'f', NULL),
  (3, 3, '5JEyuesMEBg5Y0LfX6Qnj6QFZpbXeufmhrtXE2P52WZ5XcNe', 1, 'heibai', 1773059298, 1773547670, -1, -99852, 't', 'f', '', '', 99852, 'service', 'f', NULL),
  (18, 27, 'qyWgsHCsDicFyw4YsHtoTO0gj1soNGPQ6WajcoAdqY7vi246', 1, 'new', 1776240575, 1777236295, -1, -21617504, 't', 'f', '', '', 21617504, 'service', 'f', NULL),
  (9, 7, 'CAK0fCjgVmkcqRdaMHFUUZUz9yYI5l89kYMw1Uvar8WoTxwS', 1, 'maservice', 1773914333, 1777217664, -1, -28923482, 't', 'f', '', '', 28923482, '', 'f', NULL),
  (22, 26, 'pBKgtjf303026jZDcP1NjIVF6cek7JplqDDHKVtWv4aml0AA', 1, 'eldyz2026', 1776569143, 1777341908, -1, -12590296, 't', 't', 'gpt-5.4,claude-haiku-4-5-20251001,claude-sonnet-4-6', '', 12590296, 'service', 'f', NULL),
  (11, 16, 'BEVcdG3SJMWlMotiKGBH1XhgzZQJ47R02sOs9FVmrKRKvu1b', 1, 'openclaw', 1775631311, 1777223626, -1, -23174987, 't', 'f', '', '', 23174987, 'service', 'f', NULL),
  (12, 17, 'C3Kmx20YiwCY9ukf9ySMfLtTO4FZMAfcxpN1Bq9OWHsNwzLP', 1, 'gemini', 1775977167, 1776186528, -1, -15165668, 't', 'f', '', '', 15165668, 'service', 'f', NULL);

INSERT INTO users (
  tenant_id, username, password, display_name, role, status, email,
  github_id, discord_id, oidc_id, wechat_id, telegram_id, access_token,
  quota, used_quota, request_count, "group", aff_code, aff_count,
  aff_quota, aff_history, inviter_id, user_level_id, top_up_count,
  subscription_purchase_count, deleted_at, linux_do_id, setting, remark,
  stripe_customer, ip_set, merged_into
)
SELECT
  1 AS tenant_id,
  s.username,
  s.password,
  s.display_name,
  s.role,
  s.status,
  s.email,
  s.github_id,
  s.discord_id,
  s.oidc_id,
  s.wechat_id,
  s.telegram_id,
  CASE
    WHEN s.access_token IS NULL OR s.access_token = '' THEN s.access_token
    WHEN EXISTS (
      SELECT 1 FROM users u
      WHERE u.access_token = s.access_token
        AND NOT (u.tenant_id = 1 AND u.username = s.username)
    ) THEN NULL
    ELSE s.access_token
  END AS access_token,
  s.quota,
  s.used_quota,
  s.request_count,
  s."group",
  CASE
    WHEN s.aff_code IS NULL OR s.aff_code = '' THEN ('svc_' || s.old_id::text)
    WHEN EXISTS (
      SELECT 1 FROM users u
      WHERE u.aff_code = s.aff_code
        AND NOT (u.tenant_id = 1 AND u.username = s.username)
    ) THEN ('svc_' || s.old_id::text)
    ELSE s.aff_code
  END AS aff_code,
  s.aff_count,
  s.aff_quota,
  s.aff_history,
  0 AS inviter_id,
  0 AS user_level_id,
  0 AS top_up_count,
  0 AS subscription_purchase_count,
  s.deleted_at,
  s.linux_do_id,
  s.setting,
  s.remark,
  s.stripe_customer,
  '' AS ip_set,
  0 AS merged_into
FROM __migrate_service_users s
ON CONFLICT (tenant_id, username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  email = EXCLUDED.email,
  github_id = EXCLUDED.github_id,
  discord_id = EXCLUDED.discord_id,
  oidc_id = EXCLUDED.oidc_id,
  wechat_id = EXCLUDED.wechat_id,
  telegram_id = EXCLUDED.telegram_id,
  access_token = EXCLUDED.access_token,
  quota = EXCLUDED.quota,
  used_quota = EXCLUDED.used_quota,
  request_count = EXCLUDED.request_count,
  "group" = EXCLUDED."group",
  aff_count = EXCLUDED.aff_count,
  aff_quota = EXCLUDED.aff_quota,
  aff_history = EXCLUDED.aff_history,
  linux_do_id = EXCLUDED.linux_do_id,
  setting = EXCLUDED.setting,
  remark = EXCLUDED.remark,
  stripe_customer = EXCLUDED.stripe_customer,
  deleted_at = EXCLUDED.deleted_at;

WITH desired_memberships AS (
  SELECT
    1 AS tenant_id,
    u.id AS user_id,
    1 AS role,
    s.status,
    0 AS invited_by,
    EXTRACT(EPOCH FROM NOW())::bigint AS created_at,
    EXTRACT(EPOCH FROM NOW())::bigint AS updated_at,
    NULL::timestamptz AS deleted_at
  FROM __migrate_service_users s
  JOIN users u ON u.tenant_id = 1 AND u.username = s.username
),
updated_memberships AS (
  UPDATE tenant_memberships tm
  SET
    role = d.role,
    status = d.status,
    invited_by = d.invited_by,
    updated_at = d.updated_at,
    deleted_at = NULL
  FROM desired_memberships d
  WHERE tm.tenant_id = d.tenant_id AND tm.user_id = d.user_id
  RETURNING tm.id
)
INSERT INTO tenant_memberships (
  tenant_id, user_id, role, status, invited_by, created_at, updated_at, deleted_at
)
SELECT
  d.tenant_id, d.user_id, d.role, d.status, d.invited_by,
  d.created_at, d.updated_at, d.deleted_at
FROM desired_memberships d
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_memberships tm
  WHERE tm.tenant_id = d.tenant_id AND tm.user_id = d.user_id
);

INSERT INTO tokens (
  tenant_id, user_id, "key", status, name, created_time, accessed_time,
  expired_time, remain_quota, unlimited_quota, model_limits_enabled,
  model_limits, allow_ips, used_quota, "group", cross_group_retry,
  app_id, is_guest, deleted_at
)
SELECT
  1 AS tenant_id,
  u.id AS user_id,
  t."key",
  t.status,
  t.name,
  t.created_time,
  t.accessed_time,
  t.expired_time,
  t.remain_quota,
  t.unlimited_quota,
  t.model_limits_enabled,
  t.model_limits,
  t.allow_ips,
  t.used_quota,
  t."group",
  t.cross_group_retry,
  0 AS app_id,
  false AS is_guest,
  t.deleted_at
FROM __migrate_service_tokens t
JOIN __migrate_service_users s ON s.old_id = t.old_user_id
JOIN users u ON u.tenant_id = 1 AND u.username = s.username
ON CONFLICT ("key") DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  user_id = EXCLUDED.user_id,
  status = EXCLUDED.status,
  name = EXCLUDED.name,
  created_time = EXCLUDED.created_time,
  accessed_time = EXCLUDED.accessed_time,
  expired_time = EXCLUDED.expired_time,
  remain_quota = EXCLUDED.remain_quota,
  unlimited_quota = EXCLUDED.unlimited_quota,
  model_limits_enabled = EXCLUDED.model_limits_enabled,
  model_limits = EXCLUDED.model_limits,
  allow_ips = EXCLUDED.allow_ips,
  used_quota = EXCLUDED.used_quota,
  "group" = EXCLUDED."group",
  cross_group_retry = EXCLUDED.cross_group_retry,
  app_id = EXCLUDED.app_id,
  is_guest = EXCLUDED.is_guest,
  deleted_at = EXCLUDED.deleted_at;

-- Optional verification before COMMIT:
-- SELECT old_id, username FROM __migrate_service_users; -- temp table exists only before commit
-- SELECT id, username, quota, used_quota, "group" FROM users WHERE tenant_id = 1 AND username IN (SELECT username FROM __migrate_service_users);

COMMIT;
