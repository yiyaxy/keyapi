import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { DashboardPage } from '@/pages/Dashboard';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => server.resetHandlers());

describe('integration: dashboard loads', () => {
  test('quota card + activity render with mocked data', async () => {
    server.use(
      http.get('/api/user/self', ({ request }) => {
        if (!request.headers.get('new-api-user')) {
          return HttpResponse.json({ success: false }, { status: 401 });
        }
        return HttpResponse.json({
          success: true,
          data: {
            id: 42,
            username: 'alice',
            email: 'a@b',
            display_name: 'A',
            role: 1,
            platform_role: 0,
            tenant_role: 0,
            tenant_id: 1,
            group: 'default',
            quota: 25_000_000,
            used_quota: 10_000_000,
          },
        });
      }),
      http.get('/api/data/self', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: 1,
              tenant_id: 1,
              user_id: 42,
              username: 'alice',
              model_name: 'gpt',
              created_at: 1713484800,
              token_used: 100,
              count: 5,
              quota: 1000,
            },
          ],
        })
      ),
      http.get('/api/log/self/stat', () =>
        HttpResponse.json({
          success: true,
          data: {
            quota: 10_000_000,
            rpm: 0,
            tpm: 0,
            total_requests: 1234,
            total_tokens: 567890,
            smartcache_savings_quota: 0,
          },
        })
      )
    );
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path='/dashboard' element={<DashboardPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    // QuotaCard shows balance derived from user.quota (25M raw / 500K unit = $50)
    await waitFor(() => expect(screen.getByText(/\$50\.00/)).toBeInTheDocument());
    // ActivityCard tile
    await waitFor(() => expect(screen.getByText('1,234')).toBeInTheDocument());
  });
});
