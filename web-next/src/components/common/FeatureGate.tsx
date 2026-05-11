import { Navigate, Outlet } from 'react-router-dom';

import { useAuth, type UserFeatures } from '@/hooks/useAuth';

import { FullPageSkeleton } from './FullPageSkeleton';

// Matches common.RoleAdminUser on the backend — platform_role at or above
// this threshold means the user is a member of the platform tenant with an
// admin/root role and can act cross-tenant. The backend ChatHistoryViewGate
// uses the same threshold, so keep them in sync.
const PLATFORM_ADMIN_THRESHOLD = 10;

// FeatureGate blocks routes whose tenant-level feature flag is off.
// Platform admins always pass — they need access for cross-tenant ops.
// Without this, a user could deep-link to /admin/chat-history even with
// the menu hidden; the API still returns 403, but the empty page would
// be confusing.
export function FeatureGate({ feature }: { feature: keyof UserFeatures }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullPageSkeleton />;
  if (status !== 'authenticated' || !user) {
    return <Navigate to='/login' replace />;
  }
  if ((user.platform_role ?? 0) >= PLATFORM_ADMIN_THRESHOLD) return <Outlet />;
  if (user.features?.[feature]) return <Outlet />;
  return <Navigate to='/forbidden' replace />;
}
