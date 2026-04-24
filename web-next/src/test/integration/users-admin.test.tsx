import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { UsersAdminPage } from '@/pages/UsersAdmin';
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
        <MemoryRouter initialEntries={['/admin/users']}>
          <Routes>
            <Route path='/admin/users' element={<UsersAdminPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('integration: users admin', () => {
  test('lists users with role + status badges and promotes via manage', async () => {
    mockAuth(100);
    let managePayload: { id: number; action: string } | null = null;
    server.use(
      http.get('/api/user/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 7,
                tenant_id: 1,
                username: 'bob',
                display_name: 'Bob',
                email: 'bob@x.com',
                role: 1,
                status: 1,
                group: 'default',
                quota: 500_000,
                used_quota: 0,
                request_count: 0,
              },
            ],
            total: 1,
          },
        })
      ),
      http.post('/api/user/manage', async ({ request }) => {
        managePayload = (await request.json()) as { id: number; action: string };
        return HttpResponse.json({ success: true, data: {} });
      })
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());
    // At least one row-level badge should reflect the user's role + status
    expect(screen.getAllByText(/^(User|普通用户)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Active|正常)$/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Promote|提升为管理员/ }));
    await waitFor(() => expect(managePayload).not.toBeNull());
    expect(managePayload!.id).toBe(7);
    expect(managePayload!.action).toBe('promote');
  });

  test('shows the user group and updates it from a select in edit dialog', async () => {
    mockAuth(100);
    let updatePayload: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/user/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 7,
                tenant_id: 1,
                username: 'bob',
                display_name: 'Bob',
                email: 'bob@x.com',
                role: 1,
                status: 1,
                group: 'default',
                quota: 500_000,
                used_quota: 0,
                request_count: 0,
              },
            ],
            total: 1,
          },
        })
      ),
      http.get('/api/group/', () =>
        HttpResponse.json({
          success: true,
          data: ['default', 'vip'],
        })
      ),
      http.put('/api/user/', async ({ request }) => {
        updatePayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: {} });
      })
    );

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());
    expect(screen.getByText('default')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Actions/ }));
    const [editItem] = await screen.findAllByRole('menuitem');
    await user.click(editItem);

    const dialog = await screen.findByRole('dialog');
    const groupSelect = within(dialog).getByRole('combobox', { name: /Group|分组/ });
    await user.click(groupSelect);
    await user.click(await screen.findByRole('option', { name: 'vip' }));
    await user.click(within(dialog).getByRole('button', { name: /Save|保存/ }));

    await waitFor(() => expect(updatePayload).not.toBeNull());
    expect(updatePayload).toMatchObject({
      id: 7,
      group: 'vip',
    });
  });
});
