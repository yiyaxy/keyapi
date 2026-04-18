import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route path='/keys' element={<KeysPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

afterEach(() => server.resetHandlers());

describe('integration: keys create', () => {
  test('empty state → dialog → new row', async () => {
    let tokensList = { items: [] as unknown[], total: 0 };
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: { auto: { ratio: '自动', desc: 'Auto' } },
        })
      ),
      http.get('/api/token/', () => HttpResponse.json({ success: true, data: tokensList })),
      http.post('/api/token/', () => {
        tokensList = {
          items: [
            {
              id: 1,
              name: 'first',
              status: 1,
              remain_quota: 0,
              used_quota: 0,
              unlimited_quota: true,
              expired_time: -1,
              created_time: 1713484800,
              model_limits_enabled: false,
              model_limits: '',
              allow_ips: '',
              group: 'auto',
              cross_group_retry: false,
              key: 'sk-test-1a2b3c4d',
            },
          ],
          total: 1,
        };
        return HttpResponse.json({ success: true });
      })
    );
    const user = userEvent.setup();
    mount();
    await waitFor(() =>
      expect(screen.getByText(/No API keys yet|暂无/)).toBeInTheDocument()
    );
    await user.click(screen.getAllByRole('button', { name: /Create key|创建/ })[0]);
    const nameInput = await screen.findByLabelText(/Name|名称/);
    await user.type(nameInput, 'first');
    await user.click(screen.getByRole('button', { name: /^Create$|^创建$/ }));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
  });
});
