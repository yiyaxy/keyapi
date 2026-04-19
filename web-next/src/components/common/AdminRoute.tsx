import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';

import { FullPageSkeleton } from './FullPageSkeleton';

const ROLE_ADMIN = 10;
const ROLE_ROOT = 100;

export function AdminRoute({ minRole = ROLE_ADMIN }: { minRole?: number }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullPageSkeleton />;
  if (status !== 'authenticated' || !user) {
    return <Navigate to='/login' replace />;
  }
  const effective = Math.max(user.role, user.platform_role, user.tenant_role);
  if (effective < minRole) {
    return <Navigate to='/forbidden' replace />;
  }
  return <Outlet />;
}

export { ROLE_ADMIN, ROLE_ROOT };
