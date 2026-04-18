import { Navigate, createBrowserRouter } from 'react-router-dom';

import { ComingSoon } from '@/components/common/ComingSoon';
import { Forbidden } from '@/components/common/Forbidden';
import { NotFound } from '@/components/common/NotFound';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { RootLayout } from '@/components/common/RootLayout';
import { RouteErrorFallback } from '@/components/common/RouteErrorFallback';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/Dashboard';
import { Forgot } from '@/pages/Forgot';
import { KeysPage } from '@/pages/Keys';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { Reset } from '@/pages/Reset';

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
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/keys', element: <KeysPage /> },
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
