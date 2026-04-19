import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});

describe('integration: keys reveal', () => {
  test('click eye → full key → 5s → mask', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                id: 1,
                name: 'k',
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
                key: 'sk-abcd1234',
              },
            ],
            total: 1,
          },
        })
      ),
      http.post('/api/token/1/key', () =>
        HttpResponse.json({ success: true, data: { key: 'sk-FULL-SECRET-VALUE' } })
      )
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    await waitFor(() => expect(screen.getByText('k')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Reveal/ }));
    await waitFor(() => expect(screen.getByText('sk-FULL-SECRET-VALUE')).toBeInTheDocument());
    act(() => vi.advanceTimersByTime(5000));
    await waitFor(() => expect(screen.queryByText('sk-FULL-SECRET-VALUE')).not.toBeInTheDocument());
  });
});
