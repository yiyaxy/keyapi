import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, delay, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => server.resetHandlers());

describe('integration: keys edit optimistic', () => {
  test('save updates table before PUT resolves', async () => {
    server.use(
      http.get('/api/user/models', () => HttpResponse.json({ success: true, data: [] })),
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: { auto: { ratio: '自动', desc: 'Auto' } },
        })
      ),
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 1,
                name: 'original',
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
                key: 'sk-x',
              },
            ],
            total: 1,
          },
        })
      ),
      http.put('/api/token/', async () => {
        await delay(200);
        return HttpResponse.json({ success: true, data: { id: 1 } });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
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
    await waitFor(() => expect(screen.getByText('original')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Edit/ }));
    const input = await screen.findByLabelText(/Name|名称/);
    await user.clear(input);
    await user.type(input, 'renamed');
    await user.click(screen.getByRole('button', { name: /^Save$|^保存$/ }));
    await waitFor(() => expect(screen.getByText('renamed')).toBeInTheDocument());
  });
});
