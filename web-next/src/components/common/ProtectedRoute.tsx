import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';

import { FullPageSkeleton } from './FullPageSkeleton';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageSkeleton />;
  }
  if (status === 'unauthenticated') {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}
