// API Response Types
// These types match the backend Go model structures

// ============================================================================
// Common Response Wrapper
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  total?: number;
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: number;
  status: number;
  email: string;
  github_id?: string;
  discord_id?: string;
  oidc_id?: string;
  wechat_id?: string;
  telegram_id?: string;
  quota: number;
  used_quota: number;
  request_count: number;
  group: string;
  aff_code: string;
  aff_count: number;
  aff_quota: number;
  aff_history_quota: number;
  inviter_id: number;
  top_up_count: number;
  linux_do_id?: string;
  setting?: string;
  remark?: string;
  stripe_customer?: string;
  ip_set?: string;
}

export interface UserSetting {
  sidebar_modules?: string;
  [key: string]: any;
}

// ============================================================================
// Token (API Key) Types
// ============================================================================

export interface Token {
  id: number;
  user_id: number;
  key: string;
  status: number;
  name: string;
  created_time: number;
  accessed_time: number;
  expired_time: number;
  remain_quota: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips?: string;
  used_quota: number;
  group: string;
  cross_group_retry: boolean;
}

// ============================================================================
// Log Types
// ============================================================================

export interface Log {
  id: number;
  user_id: number;
  created_at: number;
  type: number;
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  channel: number;
  channel_name?: string;
  token_id: number;
  group: string;
  ip: string;
  request_id?: string;
  other?: string;
}

export const LogType = {
  Unknown: 0,
  Topup: 1,
  Consume: 2,
  Manage: 3,
  System: 4,
  Error: 5,
  Refund: 6,
} as const;

export interface LogStat {
  quota: number;
  rpm: number;
  tpm: number;
}

export interface AnalyticsItem {
  name: string;
  quota: number;
  count: number;
  tokens: number;
}

export interface AnalyticsSummary {
  total_quota: number;
  total_count: number;
  total_tokens: number;
  rpm: number;
  tpm: number;
}

export interface AnalyticsResult {
  items: AnalyticsItem[];
  summary: AnalyticsSummary;
}

// ============================================================================
// Message Types
// ============================================================================

export interface Message {
  id: number;
  title: string;
  content: string;
  type: number;
  target_user_id: number;
  sender_id: number;
  status: number;
  created_at: number;
  updated_at: number;
}

export interface InboxMessage extends Message {
  is_read: boolean;
  read_at: number;
}

export const MessageType = {
  Directed: 1,
  Broadcast: 2,
} as const;

export const MessageStatus = {
  Normal: 1,
  Recalled: 2,
} as const;

// ============================================================================
// Ticket Types
// ============================================================================

export interface TicketListData<TItem = TicketListItem> {
  items: TItem[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface TicketListItem {
  id: number;
  subject?: string;
  status?: string;
  updated_at?: number | string;
  user_id?: number | string | null;
}

export interface TicketDetail {
  id: number;
  subject?: string;
  content?: string;
  status?: string;
  user_id?: number | string | null;
  created_at?: number | string;
  updated_at?: number | string;

  replies?: TicketReply[];
  ticket_replies?: TicketReply[];
  attachments?: TicketAttachment[];
}

export interface TicketReply {
  id?: number;
  role?: 'admin' | 'user' | string;
  content?: string;
  created_at?: number | string;
}

export interface TicketAttachment {
  id: number;
  object_key?: string;
  original_filename?: string;
  meta?: string | Record<string, unknown> | null;
  uploader_id?: number;
  created_at?: number | string;
}

export interface TicketUploadPresignRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface TicketUploadPresignResponse {
  upload_url: string;
  required_headers?: Record<string, string>;
  object_key: string;
  expires_at?: number | string;
}

export interface TicketAttachmentPresignResponse {
  url: string;
  expires_at?: number | string;
}

export interface CreateTicketRequest {
  subject: string;
  content: string;
  object_keys: string[];
}

export interface ReplyTicketRequest {
  content: string;
  object_keys: string[];
}

export interface UpdateTicketStatusRequest {
  status: string;
}

// ============================================================================
// Subscription Types
// ============================================================================

export interface SubscriptionPlan {
  id: number;
  title: string;
  subtitle: string;
  price_amount: number;
  currency: string;
  duration_unit: string;
  duration_value: number;
  custom_seconds: number;
  enabled: boolean;
  sort_order: number;
  stripe_price_id: string;
  creem_product_id: string;
  max_purchase_per_user: number;
  upgrade_group: string;
  promo_highlights?: string;
  total_amount: number;
  quota_reset_period: string;
  quota_reset_custom_seconds: number;
  inviter_reward_amount: number;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionOrder {
  id: number;
  user_id: number;
  plan_id: number;
  money: number;
  trade_no: string;
  payment_method: string;
  status: string;
  create_time: number;
  complete_time: number;
  client_ip: string;
  provider_payload: string;
}

export interface SubscriptionOrderWithUser extends SubscriptionOrder {
  username: string;
}

export interface UserSubscription {
  id: number;
  user_id: number;
  plan_id: number;
  amount_total: number;
  amount_used: number;
  start_time: number;
  end_time: number;
  status: string;
  source: string;
  last_reset_time: number;
  next_reset_time: number;
  upgrade_group: string;
  prev_user_group: string;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionSummary {
  subscription: UserSubscription;
}

export const SubscriptionDuration = {
  Year: 'year',
  Month: 'month',
  Day: 'day',
  Hour: 'hour',
  Custom: 'custom',
} as const;

export const SubscriptionResetPeriod = {
  Never: 'never',
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Custom: 'custom',
} as const;

// ============================================================================
// Channel Types
// ============================================================================

export interface Channel {
  id: number;
  type: number;
  key: string;
  status: number;
  name: string;
  weight: number;
  created_time: number;
  test_time: number;
  response_time: number;
  base_url?: string;
  other?: string;
  balance: number;
  balance_updated_time: number;
  models: string;
  group: string;
  used_quota: number;
  model_mapping?: string;
  priority: number;
  auto_ban: number;
  is_edit?: number;
  status_code_mapping?: string;
  headers?: string;
  model_test?: string;
  pre_cost?: number;
  config?: string;
}

// ============================================================================
// TopUp (Recharge) Types
// ============================================================================

export interface TopUp {
  id: number;
  user_id: number;
  amount: number;
  money: number;
  trade_no: string;
  payment_method: string;
  create_time: number;
  complete_time: number;
  status: string;
  client_ip: string;
}

export const TopUpStatus = {
  Pending: 'pending',
  Success: 'success',
  Failed: 'failed',
  Expired: 'expired',
} as const;

// ============================================================================
// Redemption Types
// ============================================================================

export interface Redemption {
  id: number;
  user_id: number;
  key: string;
  status: number;
  name: string;
  quota: number;
  created_time: number;
  redeemed_time: number;
  count: number;
  used_count: number;
}

export const RedemptionStatus = {
  Enabled: 1,
  Disabled: 2,
  Used: 3,
} as const;

// ============================================================================
// Model Types
// ============================================================================

export interface ModelPrice {
  model: string;
  type: number;
  channel_type: number;
  owner_by: string;
  input: number;
  output: number;
  completion_ratio: number;
  model_ratio: number;
  group_ratio: string;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
  verification_code?: string;
  aff_code?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: User;
}

// ============================================================================
// System Status Types
// ============================================================================

export interface SystemStatus {
  version: string;
  start_time: number;
  request_count: number;
  user_count: number;
  channel_count: number;
}

// ============================================================================
// Option Types
// ============================================================================

export interface Option {
  key: string;
  value: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type SortOrder = 'asc' | 'desc';

export interface PageInfo {
  page: number;
  page_size: number;
}

export interface SearchParams extends PageInfo {
  keyword?: string;
  [key: string]: any;
}

// ============================================================================
// Aff Transfer Request Types
// ============================================================================

export interface AffTransferRequest {
  id: number;
  user_id: number;
  username: string;
  quota: number;
  status: number; // 1=pending 2=approved 3=rejected
  admin_id: number;
  admin_remark: string;
  created_at: number;
  updated_at: number;
}

export const AffTransferStatus = {
  Pending: 1,
  Approved: 2,
  Rejected: 3,
} as const;

// ============================================================================
// Aff Rebate Log Types
// ============================================================================

export interface AffRebateLog {
  id: number;
  user_id: number;
  invitee_id: number;
  invitee_name: string;
  type: number;  // 1=register bonus, 2=topup rebate
  quota: number;
  remark: string;
  created_at: number;
}

// ============================================================================
// User Rebate Setting Types
// ============================================================================

export interface UserRebateSetting {
  id: number;
  inviter_id: number;
  inviter_username: string;
  register_reward: number;
  invitee_reward: number;
  top_up_rebate_count: number;
  top_up_rebate_percent: number;
  subscription_rebate_count: number;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Invoice Types
// ============================================================================

export interface InvoiceableOrder {
  source_type: string;   // "topup" | "subscription"
  source_id: number;
  trade_no: string;
  money: number;
  currency: string;
  payment_method: string;
  complete_time: number;
}

export interface InvoiceFile {
  id: number;
  invoice_id: number;
  object_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number | null;
  file_kind?: string;
  source?: string;
}

export interface InvoiceApplication {
  id: number;
  user_id: number;
  invoice_type: string;
  title: string;
  tax_id: string;
  email: string;
  status: string;
  issue_status?: string;
  provider?: string;
  issue_mode?: string;
  total_money: number;
  currency: string;
  apply_remark: string;
  admin_remark: string;
  reject_reason: string;
  issue_kind_code?: string;
  piaotong_serial_no?: string;
  piaotong_invoice_req_serial_no?: string;
  piaotong_invoice_code?: string;
  piaotong_invoice_no?: string;
  piaotong_blue_all_ele_inv_no?: string;
  piaotong_invoice_status?: string;
  piaotong_auth_id?: string;
  issue_attempts?: number;
  query_attempts?: number;
  last_issue_attempt_at?: number;
  last_query_at?: number;
  next_query_at?: number;
  issue_error_code?: string;
  issue_error_message?: string;
  file_fetch_status?: string;
  file_fetched_at?: number;
  created_at: number;
  updated_at: number;
  approved_at: number;
  issued_at: number;
  cancelled_at: number;
  username?: string;
}

export interface InvoiceItem {
  id: number;
  source_type: string;
  source_id: number;
  trade_no: string;
  money: number;
  currency: string;
  payment_method: string;
  complete_time: number;
}

export interface InvoiceApplicationDetail {
  application: InvoiceApplication;
  items: InvoiceItem[];
  files: InvoiceFile[];
}

// ============================================================================
// Tenant Types
// ============================================================================

export * from './tenant';
