import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { AdminRoute } from '@/components/common/AdminRoute';
import { ChannelsAdminPage } from '@/pages/ChannelsAdmin';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => {
  server.resetHandlers();
  localStorage.removeItem('new-api.auth-bootstrap');
});

function mockAuth(role: number) {
  localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 1, tenant_id: 1 }));
  server.use(
    http.get('/api/user/self', () =>
      HttpResponse.json({
        success: true,
        data: {
          id: 1,
          username: 'root',
          email: 'r@e.com',
          display_name: 'Root',
          role,
          platform_role: role,
          tenant_role: role,
          tenant_id: 1,
          group: 'default',
          quota: 0,
          used_quota: 0,
        },
      })
    )
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/channels']}>
          <Routes>
            <Route element={<AdminRoute />}>
              <Route path='/admin/channels' element={<ChannelsAdminPage />} />
            </Route>
            <Route path='/forbidden' element={<div>FORBIDDEN</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('integration: channels admin', () => {
  test('non-admin redirected to /forbidden', async () => {
    mockAuth(1);
    renderPage();
    await waitFor(() => expect(screen.getByText('FORBIDDEN')).toBeInTheDocument());
  });

  test('admin sees list, opens edit, deletes', async () => {
    mockAuth(100);
    let deleted = false;
    server.use(
      http.get('/api/channel/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 1,
                tenant_id: 1,
                type: 1,
                key: '',
                name: 'openai-main',
                status: 1,
                weight: 0,
                created_time: 1,
                test_time: 0,
                response_time: 120,
                base_url: '',
                other: '',
                balance: 0,
                balance_updated_time: 0,
                models: 'gpt-4o',
                group: 'default',
                used_quota: 0,
                priority: 10,
                auto_ban: 1,
                max_retry: 0,
                tag: null,
                remark: null,
              },
            ],
            total: 1,
            page: 1,
            page_size: 50,
            type_counts: {},
          },
        })
      ),
      http.delete('/api/channel/:id', () => {
        deleted = true;
        return HttpResponse.json({ success: true, data: {} });
      })
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('openai-main')).toBeInTheDocument());
    expect(screen.getByText('120 ms')).toBeInTheDocument();

    // Open actions → Delete → confirm
    await user.click(screen.getByRole('button', { name: /Actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete|删除/ }));
    await user.click(screen.getByRole('button', { name: /^Delete$|^删除$/ }));
    await waitFor(() => expect(deleted).toBe(true));
  });
});
