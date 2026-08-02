-- Fixed-id PostgreSQL insert SQL generated from origin/users.sql and origin/tokens.sql
-- Regenerated at: 2026-04-28T14:17:48
-- Scope: old users."group" = 'service' AND old users.role = 1
-- Target tenant_id: 1
-- New users.id starts at 29; current target users sequence was reported as 28.
-- Target users table does not have user_level_id, so this script intentionally omits it.
-- old user 2 -> new user 29: 'service_moxing'
-- old user 3 -> new user 30: 'heibai'
-- old user 4 -> new user 31: 'customer_system'
-- old user 6 -> new user 32: 'jiaservice'
-- old user 7 -> new user 33: 'maservice'
-- old user 16 -> new user 34: '19857019796'
-- old user 17 -> new user 35: 'atservice'
-- old user 26 -> new user 36: 'qianservice'
-- old user 27 -> new user 37: 'doctorsevice'
-- old user 30 -> new user 38: 'mingyu'

BEGIN;

INSERT INTO users (id, tenant_id, username, password, display_name, role, status, email, github_id, discord_id, oidc_id, wechat_id, telegram_id, access_token, quota, used_quota, request_count, "group", aff_code, aff_count, aff_quota, aff_history, inviter_id, top_up_count, subscription_purchase_count, deleted_at, linux_do_id, setting, remark, stripe_customer, ip_set, merged_into) VALUES
  (29, 1, 'service_moxing', '$2a$10$cuqrsYa//4hanjLTdWpo3OwUWYkIs.LrPk7ktFORApJgcdyMXaFvC', '账号1', 1, 1, '', '', '', '', '', '', 'ZetufhSfYQTJ1N3vFVyIhrpyMUeAvg==', 12930877, 7214464, 336, 'service', 'Jzon', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}","language":"zh-CN"}', '', '', '', 0),
  (30, 1, 'heibai', '$2a$10$xBzoamZtqf66bnpC1Cotx.KcjfftGkhNB.1JI8J8YA3z2rNMOBtC.', 'heibai', 1, 1, '', '', '', '', '', '', NULL, 7125582, 99852, 49, 'service', '1mRj', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (31, 1, 'customer_system', '$2a$10$BciC5eoqXkEhwyQ8v03b/.kxdisJXW/UiCOVjPmzUxIHTH7MjTRlK', '客服系统', 1, 1, '', '', '', '', '', '', NULL, 1604654, 2008063, 55, 'service', 'HJ6B', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}","language":"zh-CN"}', '', '', '', 0),
  (32, 1, 'jiaservice', '$2a$10$9iceukh2M1i19/XopFYeau/XTPNL/JCM9E6nQFkSQqerK3onUy5tW', 'jiaservice', 1, 1, '', '', '', '', '', '', NULL, 7181060, 44474, 11, 'service', 'ATlk', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (33, 1, 'maservice', '$2a$10$0R8ummcf3XKbG40WHFINnuDOAihL0TPFI48XS6bpPh2.tVH6U2RLq', 'maservice', 1, 1, '', '', '', '', '', '', NULL, -4406, 28923482, 508, 'service', 'B30I', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (34, 1, '19857019796', '$2a$10$4MiwKoDktSd1D.S9i/tbhe3wECgdsWtlLqDcNPG64STCD5HHhiGVi', '糖', 1, 1, '', '', '', '', '', '', NULL, 1825013, 23174987, 850, 'service', 'Qkjr', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (35, 1, 'atservice', '$2a$10$MLg3.NaORJRUvXwaUmPx3.mmcr5yIgH5pse9BH1IFjORrwsnJElPu', 'at', 1, 1, '', '', '', '', '', '', NULL, 7742, 15165668, 707, 'service', 'Jjw0', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (36, 1, 'qianservice', '$2a$10$.M8.sh7No4jYoX4m4VmNaOGAxs/4QX85X1CpT7wSvrIX1s9DTo5Wm', 'qianservice', 1, 1, '', '', '', '', '', '', NULL, 59664039, 12590296, 721, 'service', 'FmmQ', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (37, 1, 'doctorsevice', '$2a$10$.A0JcducCZRvZ.lrU.iUZ.Hz.hwA0rAtrKW6GtZCGwobSDSPHZ9g.', 'doctorsevice', 1, 1, '', '', '', '', '', '', NULL, 58797, 21617504, 1184, 'service', 'Fm70', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0),
  (38, 1, 'mingyu', '$2a$10$OfN/qs8yvYWNali.5uAi5et58NgyvORsxOzM6ACHb1jBz6W4VqAHS', 'mingyu', 1, 1, '', '', '', '', '', '', NULL, 3548562, 64155, 12, 'service', 'h2mn', 0, 0, 0, 0, 0, 0, NULL, '', '{"gotify_priority":0,"sidebar_modules":"{\"chat\":{\"chat\":true,\"enabled\":true,\"playground\":true},\"console\":{\"detail\":true,\"enabled\":true,\"log\":true,\"midjourney\":true,\"task\":true,\"token\":true},\"personal\":{\"enabled\":true,\"personal\":true,\"topup\":true}}"}', '', '', '', 0);

-- Keep the users id sequence ahead of the explicit ids inserted above.
SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 38), true);

-- Required by the new tenant membership model.
INSERT INTO tenant_memberships (tenant_id, user_id, role, status, invited_by, created_at, updated_at, deleted_at) VALUES
  (1, 29, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 30, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 31, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 32, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 33, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 34, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 35, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 36, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 37, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL),
  (1, 38, 1, 1, 0, EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint, NULL);

-- Token id is omitted so the target database sequence assigns fresh token ids.
INSERT INTO tokens (tenant_id, user_id, "key", status, name, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, allow_ips, used_quota, "group", cross_group_retry, app_id, is_guest, deleted_at) VALUES
  (1, 29, 'bZnVeILl82T8jyqheOoI5Y07f6uHrxWDbrVbeGMgtnpEUfvC', 1, '测试', 1772605413, 1773286057, -1, -2976003, true, false, '', '', 2976003, 'service', false, 0, false, NULL),
  (1, 29, 'GOLW7cXKmCgSvHWpwhe9xl0CgK3bjCxH5ksfzM3kv1UlJj8r', 1, 'service', 1773029326, 1773416030, -1, -3374336, true, true, 'gpt-5.4', '', 3374336, 'service', false, 0, false, NULL),
  (1, 29, 'oCUFpsF4BcesQTblWy59BDvwtfW9XaNoGY8ixpFny30BvOPP', 1, 'FELIX', 1774328519, 1774495803, -1, -1041165, true, false, '', '', 1041165, '', false, 0, false, NULL),
  (1, 30, '5JEyuesMEBg5Y0LfX6Qnj6QFZpbXeufmhrtXE2P52WZ5XcNe', 1, 'heibai', 1773059298, 1773547670, -1, -99852, true, false, '', '', 99852, 'service', false, 0, false, NULL),
  (1, 31, 'WBiAngKdm55FyvEFap6EXXyk4GzwWWkBrEZo6S0id2VnoJde', 1, '客服', 1773406541, 1773412114, -1, -2008063, true, false, '', '', 2008063, '', false, 0, false, NULL),
  (1, 32, 'CgdNJpro8NrL34YksNdkKSJR8wzakUGGMRpc5BU7Cp1VuZAp', 1, 'jiaservice', 1773910009, 1773911290, -1, -44474, true, false, '', '', 44474, 'service', false, 0, false, NULL),
  (1, 33, 'CAK0fCjgVmkcqRdaMHFUUZUz9yYI5l89kYMw1Uvar8WoTxwS', 1, 'maservice', 1773914333, 1777217664, -1, -28923482, true, false, '', '', 28923482, '', false, 0, false, NULL),
  (1, 34, 'BEVcdG3SJMWlMotiKGBH1XhgzZQJ47R02sOs9FVmrKRKvu1b', 1, 'openclaw', 1775631311, 1777223626, -1, -23174987, true, false, '', '', 23174987, 'service', false, 0, false, NULL),
  (1, 35, 'C3Kmx20YiwCY9ukf9ySMfLtTO4FZMAfcxpN1Bq9OWHsNwzLP', 1, 'gemini', 1775977167, 1776186528, -1, -15165668, true, false, '', '', 15165668, 'service', false, 0, false, NULL),
  (1, 36, 'pBKgtjf303026jZDcP1NjIVF6cek7JplqDDHKVtWv4aml0AA', 1, 'eldyz2026', 1776569143, 1777341908, -1, -12590296, true, true, 'gpt-5.4,claude-haiku-4-5-20251001,claude-sonnet-4-6', '', 12590296, 'service', false, 0, false, NULL),
  (1, 37, 'qyWgsHCsDicFyw4YsHtoTO0gj1soNGPQ6WajcoAdqY7vi246', 1, 'new', 1776240575, 1777236295, -1, -21617504, true, false, '', '', 21617504, 'service', false, 0, false, NULL);

COMMIT;
