import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';

import { onAuthEvent, onToast } from '@/lib/api';

import { AuthProvider } from './AuthProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

function ApiEventBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const offAuth = onAuthEvent((event) => {
      if (event === 'unauthorized') {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        const publicRoutes = [
          '/login',
          '/register',
          '/forgot',
          '/reset',
          '/user/reset',
          '/forbidden',
        ];
        const onPublic = publicRoutes.some((p) => window.location.pathname.startsWith(p));
        if (!onPublic) navigate(`/login?redirect=${redirect}`);
      } else if (event === 'forbidden') {
        navigate('/forbidden');
      }
    });
    const offToast = onToast((_, message) => {
      toast.error(message);
    });
    return () => {
      offAuth();
      offToast();
    };
  }, [navigate]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiEventBridge />
        {children}
        <Toaster position='top-right' richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
