import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { AccountPage } from '@/pages/Account';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => {
  server.resetHandlers();
  localStorage.removeItem('new-api.auth-bootstrap');
});

function mockAuth(user: Partial<Record<string, unknown>> = {}) {
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
          quota: 1_000_000,
          used_quota: 0,
          github_id: 'alice',
          ...user,
        },
      })
    )
  );
}

describe('integration: account change password', () => {
  test('submit with mismatched confirm shows error, submit with match PUTs /api/user/self', async () => {
    mockAuth();
    let putBody: { password?: string; original_password?: string } | null = null;
    server.use(
      http.put('/api/user/self', async ({ request }) => {
        const body = await request.json();
        putBody = body as { password?: string; original_password?: string };
        return HttpResponse.json({ success: true, data: {} });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/account']}>
            <Routes>
              <Route path='/account' element={<AccountPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());

    const current = screen.getByLabelText(/Current password|当前密码/);
    const next = screen.getByLabelText(/^New password$|^新密码$/);
    const confirm = screen.getByLabelText(/Confirm|再次/);

    await user.type(current, 'oldpass12');
    await user.type(next, 'newpass12');
    await user.type(confirm, 'different1');
    await user.click(screen.getByRole('button', { name: /Update password|更新密码/ }));
    await waitFor(() => expect(screen.getByText(/do not match|不一致/)).toBeInTheDocument());
    expect(putBody).toBeNull();

    await user.clear(confirm);
    await user.type(confirm, 'newpass12');
    await user.click(screen.getByRole('button', { name: /Update password|更新密码/ }));
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody!.password).toBe('newpass12');
    expect(putBody!.original_password).toBe('oldpass12');
  });

  test('linked accounts reflect bound/unbound state', async () => {
    mockAuth({ github_id: 'alice', discord_id: '' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/account']}>
            <Routes>
              <Route path='/account' element={<AccountPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    const githubRow = screen.getByText('GitHub').parentElement?.parentElement;
    const discordRow = screen.getByText('Discord').parentElement?.parentElement;
    expect(githubRow?.textContent).toMatch(/Linked|已绑定/);
    expect(discordRow?.textContent).toMatch(/Not linked|未绑定/);
  });
});
