import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { onAuthEvent, onToast } from '@/lib/api';

export function RootLayout() {
  const navigate = useNavigate();
  useEffect(() => {
    const offAuth = onAuthEvent((event) => {
      if (event === 'unauthorized') {
        const current = window.location.pathname + window.location.search;
        const publicRoutes = [
          '/login',
          '/register',
          '/forgot',
          '/reset',
          '/user/reset',
          '/forbidden',
        ];
        if (!publicRoutes.some((p) => window.location.pathname.startsWith(p))) {
          navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
        }
      } else if (event === 'forbidden') {
        navigate('/forbidden', { replace: true });
      }
    });
    const offToast = onToast((_, message) => toast.error(message));
    return () => {
      offAuth();
      offToast();
    };
  }, [navigate]);
  return <Outlet />;
}
