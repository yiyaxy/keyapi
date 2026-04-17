// Tenant model types — keep in sync with model/tenant.go and model/tenant_membership.go.

// Tenant config key metadata — drives the grouped TenantConfigEditor UI.
export type TenantConfigKeyType =
  | 'string'
  | 'textarea'
  | 'bool'
  | 'list'
  | 'password'
  | 'url';

export type TenantConfigGroup =
  | 'brand'
  | 'auth'
  | 'features'
  | 'billing'
  | 'webhook';

export interface TenantConfigKeyMeta {
  key: string;
  group: TenantConfigGroup;
  labelKey: string; // i18n key (translated via useTranslation)
  descriptionKey?: string;
  type: TenantConfigKeyType;
  placeholder?: string;
}

export const TENANT_CONFIG_KEY_METADATA: TenantConfigKeyMeta[] = [
  // brand
  { key: 'SystemName', group: 'brand', labelKey: '站点名称', type: 'string' },
  {
    key: 'Logo',
    group: 'brand',
    labelKey: 'Logo URL',
    type: 'url',
    placeholder: 'https://example.com/logo.png',
  },
  { key: 'Footer', group: 'brand', labelKey: '页脚 HTML', type: 'textarea' },
  { key: 'Notice', group: 'brand', labelKey: '公告内容', type: 'textarea' },
  { key: 'About', group: 'brand', labelKey: '关于页面', type: 'textarea' },
  {
    key: 'HomePageContent',
    group: 'brand',
    labelKey: '首页内容',
    type: 'textarea',
  },
  // auth
  {
    key: 'PasswordLoginEnabled',
    group: 'auth',
    labelKey: '允许密码登录',
    type: 'bool',
  },
  {
    key: 'PasswordRegisterEnabled',
    group: 'auth',
    labelKey: '允许密码注册',
    type: 'bool',
  },
  {
    key: 'RegisterEnabled',
    group: 'auth',
    labelKey: '允许注册',
    type: 'bool',
  },
  {
    key: 'EmailVerificationEnabled',
    group: 'auth',
    labelKey: '强制邮箱验证',
    type: 'bool',
  },
  {
    key: 'EmailDomainRestrictionEnabled',
    group: 'auth',
    labelKey: '邮箱域白名单启用',
    type: 'bool',
  },
  {
    key: 'EmailDomainWhitelist',
    group: 'auth',
    labelKey: '邮箱域白名单（逗号分隔）',
    type: 'list',
    placeholder: 'gmail.com, outlook.com',
  },
  // features
  {
    key: 'DrawingEnabled',
    group: 'features',
    labelKey: '启用画图',
    type: 'bool',
  },
  {
    key: 'TaskEnabled',
    group: 'features',
    labelKey: '启用 Midjourney 任务',
    type: 'bool',
  },
  {
    key: 'DataExportEnabled',
    group: 'features',
    labelKey: '启用数据导出',
    type: 'bool',
  },
  {
    key: 'DisplayInCurrencyEnabled',
    group: 'features',
    labelKey: '用货币显示额度',
    type: 'bool',
  },
  {
    key: 'DisplayTokenStatEnabled',
    group: 'features',
    labelKey: '显示 Token 统计',
    type: 'bool',
  },
  // billing
  { key: 'TopUpLink', group: 'billing', labelKey: '充值链接', type: 'url' },
  // webhook
  {
    key: 'WebhookURL',
    group: 'webhook',
    labelKey: 'Webhook URL',
    type: 'url',
    placeholder: 'https://your-server.example.com/hook',
  },
  {
    key: 'WebhookSecret',
    group: 'webhook',
    labelKey: 'Webhook Secret',
    type: 'password',
  },
];

export const TENANT_CONFIG_GROUP_TITLES: Record<TenantConfigGroup, string> = {
  brand: '品牌展示',
  auth: '认证 & 注册',
  features: '功能开关',
  billing: '计费展示',
  webhook: '告警 Webhook',
};

export const TenantStatus = {
  Active: 1,
  Suspended: 2,
  Deleted: 3,
} as const;
export type TenantStatusValue = (typeof TenantStatus)[keyof typeof TenantStatus];

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: TenantStatusValue;
  created_at: number;
  updated_at: number;
}

export const TenantRole = {
  Member: 1, // common.RoleCommonUser
  Admin: 10, // common.RoleAdminUser
} as const;
export type TenantRoleValue = (typeof TenantRole)[keyof typeof TenantRole];

export const TenantMembershipStatus = {
  Active: 1,
  Disabled: 2,
  Removed: 3,
} as const;
export type TenantMembershipStatusValue =
  (typeof TenantMembershipStatus)[keyof typeof TenantMembershipStatus];

export interface TenantMembership {
  id: number;
  tenant_id: number;
  user_id: number;
  role: TenantRoleValue;
  status: TenantMembershipStatusValue;
  invited_by: number;
  created_at: number;
  updated_at: number;
}

export interface TenantMemberListItem {
  id: number;
  tenant_id: number;
  user_id: number;
  username: string;
  display_name: string;
  email: string;
  tenant_role: TenantRoleValue;
  platform_role: number;
  role: number; // effective role
  membership_status: TenantMembershipStatusValue;
  status: number; // user.status
  group: string;
  quota: number;
  used_quota: number;
  request_count: number;
}

// TenantPlan — keep in sync with model/tenant_plan.go.
export interface TenantPlan {
  id: number;
  tenant_id: number;
  plan_name: string;
  quota_limit: number;
  rpm_limit: number;
  tpm_limit: number;
  max_members: number;
  max_tokens: number;
  max_channels: number;
  allowed_models: string;
  status: number; // 1=active, 0=disabled
  expires_at: number; // unix seconds, 0 = never expires
  grace_period_seconds?: number; // grace period after expires_at before disabling
  created_at: number;
  updated_at: number;
}

// POST /api/tenant/invite response (union)
export interface InviteJoinedResponse {
  status: 'joined';
  user_id: number;
  email: string;
}
export interface InviteCreatedResponse {
  status: 'invited';
  email: string;
  token: string;
}
export type InviteResponse = InviteJoinedResponse | InviteCreatedResponse;

// TenantAuditLog — keep in sync with model/tenant_audit_log.go.
export interface TenantAuditLog {
  id: number;
  tenant_id: number;
  actor_user_id: number;
  actor_role: string;
  action: string;
  target: string;
  target_id: number;
  detail: string;
  client_ip: string;
  created_at: number;
}

export interface TenantAuditLogListResponse {
  items: TenantAuditLog[];
  total: number;
  limit: number;
  offset: number;
}

// ---------- Payment Configs ----------

export interface TenantPaymentConfigView {
  id: number;
  provider: 'wechat';
  enabled: boolean;
  platform_locked: boolean;
  app_id: string;
  mchid: string;
  serial_no: string;
  app_secret_set: boolean;
  apiv3_key_set: boolean;
  private_key_set: boolean;
  last_test_at: number;
  last_test_ok: boolean;
  last_test_error: string;
  created_at: number;
  updated_at: number;
}

export interface UpdateWechatConfigRequest {
  enabled?: boolean;
  app_id?: string;
  mchid?: string;
  serial_no?: string;
  // Empty string means "leave existing ciphertext alone".
  app_secret?: string;
  apiv3_key?: string;
  private_key?: string;
}
