import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { RedemptionAdminPage } from '@/pages/RedemptionAdmin';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => {
  server.resetHandlers();
  localStorage.removeItem('new-api.auth-bootstrap');
});

function mockAuth() {
  localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 1, tenant_id: 1 }));
  server.use(
    http.get('/api/user/self', () =>
      HttpResponse.json({
        success: true,
        data: {
          id: 1,
          username: 'root',
          email: '',
          display_name: 'Root',
          role: 100,
          platform_role: 100,
          tenant_role: 100,
          tenant_id: 1,
          group: 'default',
          quota: 0,
          used_quota: 0,
        },
      })
    )
  );
}

describe('integration: redemption admin', () => {
  test('lists codes, deletes a row', async () => {
    mockAuth();
    let deletedId: number | null = null;
    server.use(
      http.get('/api/redemption/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 42,
                tenant_id: 1,
                user_id: 1,
                key: 'ABCDEFGH12345678IJKLMNOPQRSTUVWX',
                status: 1,
                name: 'launch-week',
                quota: 5_000_000,
                created_time: 1_713_000_000,
                redeemed_time: 0,
                used_user_id: 0,
                expired_time: 0,
              },
            ],
            total: 1,
          },
        })
      ),
      http.delete('/api/redemption/:id', ({ params }) => {
        deletedId = Number(params.id);
        return HttpResponse.json({ success: true, data: {} });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/admin/redemption']}>
            <Routes>
              <Route path='/admin/redemption' element={<RedemptionAdminPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('launch-week')).toBeInTheDocument());
    expect(screen.getByText(/ABCD…UVWX/)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete$|^删除$/ });
    await user.click(deleteButtons[0]);
    const confirmButtons = await screen.findAllByRole('button', {
      name: /^Delete$|^删除$/,
    });
    await user.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(deletedId).toBe(42));
  });
});
