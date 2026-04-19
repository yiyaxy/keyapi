import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { TopupPage } from '@/pages/Topup';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => {
  server.resetHandlers();
  localStorage.removeItem('new-api.auth-bootstrap');
});

function mockAuth(quota: number, used: number) {
  localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 1, tenant_id: 1 }));
  server.use(
    http.get('/api/user/self', () =>
      HttpResponse.json({
        success: true,
        data: {
          id: 1,
          username: 'alice',
          email: 'alice@example.com',
          display_name: 'Alice',
          role: 1,
          platform_role: 1,
          tenant_role: 1,
          tenant_id: 1,
          group: 'default',
          quota,
          used_quota: used,
        },
      })
    )
  );
}

describe('integration: topup redeem', () => {
  test('successful redeem shows toast amount and refreshes /api/user/self', async () => {
    mockAuth(500_000, 0);
    let selfCalls = 0;
    server.use(
      http.get('/api/user/self', () => {
        selfCalls += 1;
        return HttpResponse.json({
          success: true,
          data: {
            id: 1,
            username: 'alice',
            email: 'alice@example.com',
            display_name: 'Alice',
            role: 1,
            platform_role: 1,
            tenant_role: 1,
            tenant_id: 1,
            group: 'default',
            quota: selfCalls === 1 ? 500_000 : 2_000_000,
            used_quota: 0,
          },
        });
      }),
      http.post('/api/user/topup', async ({ request }) => {
        const body = (await request.json()) as { key: string };
        if (body.key === 'GOODCODE') {
          return HttpResponse.json({ success: true, data: 1_500_000 });
        }
        return HttpResponse.json({ success: false, message: 'invalid' }, { status: 200 });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/topup']}>
            <Routes>
              <Route path='/topup' element={<TopupPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText(/Used \$0\.00 of \$1\.00/)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/redemption code|兑换码/);
    await user.type(input, 'GOODCODE');
    await user.click(screen.getByRole('button', { name: /Redeem|兑换/ }));

    await waitFor(() => expect(screen.getByText(/Used \$0\.00 of \$4\.00/)).toBeInTheDocument());
    expect(selfCalls).toBeGreaterThanOrEqual(2);
  });

  test('empty redeem does not POST', async () => {
    mockAuth(500_000, 0);
    let postCount = 0;
    server.use(
      http.post('/api/user/topup', () => {
        postCount += 1;
        return HttpResponse.json({ success: true, data: 0 });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/topup']}>
            <Routes>
              <Route path='/topup' element={<TopupPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText(/Used \$0\.00 of \$1\.00/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Redeem|兑换/ }));
    // Give any pending microtasks a chance to run
    await new Promise((r) => setTimeout(r, 50));
    expect(postCount).toBe(0);
  });
});
