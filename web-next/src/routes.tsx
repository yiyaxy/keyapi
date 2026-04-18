import { useEffect } from 'react';
import { Navigate, Outlet, createBrowserRouter, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { ComingSoon } from '@/components/common/ComingSoon';
import { Forbidden } from '@/components/common/Forbidden';
import { NotFound } from '@/components/common/NotFound';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { RouteErrorFallback } from '@/components/common/RouteErrorFallback';
import { AppShell } from '@/components/layout/AppShell';
import { onAuthEvent, onToast } from '@/lib/api';
import { Forgot } from '@/pages/Forgot';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { Reset } from '@/pages/Reset';

function RootLayout() {
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

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot', element: <Forgot /> },
      { path: '/reset', element: <Reset /> },
      { path: '/user/reset', element: <Reset /> },
      { path: '/forbidden', element: <Forbidden /> },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <Navigate to='/dashboard' replace /> },
              { path: '/dashboard', element: <ComingSoon feature='Dashboard' /> },
              { path: '/keys', element: <ComingSoon feature='API keys' /> },
              { path: '/playground', element: <ComingSoon feature='Playground' /> },
              { path: '/logs', element: <ComingSoon feature='Logs' /> },
              { path: '/topup', element: <ComingSoon feature='Top up · invoices' /> },
              { path: '/plan', element: <ComingSoon feature='Plan' /> },
              { path: '/account', element: <ComingSoon feature='Account' /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
