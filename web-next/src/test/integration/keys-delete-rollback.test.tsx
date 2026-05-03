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

afterEach(() => server.resetHandlers());

describe('integration: keys delete rollback', () => {
  test('server 500 → row re-appears', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 1,
                name: 'victim',
                status: 1,
                remain_quota: 0,
                used_quota: 0,
                unlimited_quota: true,
                expired_time: -1,
                created_time: 1713484800,
                model_limits_enabled: false,
                model_limits: '',
                enable_image_gen: true,
                allow_ips: '',
                group: 'auto',
                cross_group_retry: false,
                key: 'sk-v',
              },
            ],
            total: 1,
          },
        })
      ),
      http.delete('/api/token/:id', () =>
        HttpResponse.json({ success: false, message: 'oops' }, { status: 500 })
      )
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
    await waitFor(() => expect(screen.getByText('victim')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Actions|操作/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete|删除/ }));
    await user.click(screen.getByRole('button', { name: /^Delete$|^删除$/ }));
    await waitFor(() => expect(screen.getByText('victim')).toBeInTheDocument());
  });
});
