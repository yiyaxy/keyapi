// Tenant model types — keep in sync with model/tenant.go and model/tenant_membership.go.

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
