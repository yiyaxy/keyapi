import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { LogsPage } from '@/pages/Logs';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});

function makeRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: 1,
    user_id: 2,
    created_at: 1_713_484_800 + id,
    type: 2,
    content: `content ${id}`,
    username: 'u',
    token_name: `tok${id}`,
    model_name: 'gpt-4o',
    quota: 500_000,
    prompt_tokens: 100,
    completion_tokens: 200,
    use_time: 1234,
    is_stream: false,
    channel: 7,
    channel_name: 'ch',
    token_id: id,
    group: 'default',
    ip: '127.0.0.1',
    request_id: `req-${id}`,
    other: '{}',
    ...overrides,
  };
}

describe('integration: logs list', () => {
  test('renders rows, opens detail', async () => {
    localStorage.setItem('new-api.lang', 'en');
    server.use(
      http.get('/api/log/self', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              makeRow(1, {
                other: JSON.stringify({
                  request_method: 'POST',
                  request_path: '/v1/chat/completions',
                  status_code: 429,
                  error_code: 'bad_response_status_code',
                  error_type: 'openai_error',
                  error_summary:
                    'relay error | request=POST /v1/chat/completions | channel_chain=7->8',
                }),
              }),
              makeRow(2),
            ],
            total: 2,
          },
        })
      )
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/logs']}>
            <Routes>
              <Route path='/logs' element={<LogsPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('tok1')).toBeInTheDocument());
    expect(screen.getByText('tok2')).toBeInTheDocument();
    const firstRow = screen.getByText('tok1').closest('tr');
    expect(firstRow).not.toBeNull();
    await user.click(
      within(firstRow as HTMLElement).getByRole('button', { name: /Detail|\u8be6\u60c5/ })
    );
    await waitFor(() => expect(screen.getByText(/req-1/)).toBeInTheDocument());
    expect(screen.getAllByText(/POST \/v1\/chat\/completions/)).toHaveLength(2);
    expect(screen.getByText(/channel_chain=7->8/)).toBeInTheDocument();
  });

  test('filter apply resets to page 1 and refetches', async () => {
    localStorage.setItem('new-api.lang', 'en');
    let lastUrl = '';
    server.use(
      http.get('/api/log/self', ({ request }) => {
        lastUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: { items: [makeRow(1, { token_name: 'filtered' })], total: 1 },
        });
      })
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/logs']}>
            <Routes>
              <Route path='/logs' element={<LogsPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('filtered')).toBeInTheDocument());
    const tokenInput = screen.getAllByRole('textbox')[0];
    await user.clear(tokenInput);
    await user.type(tokenInput, 'myTok');
    await user.click(screen.getByRole('button', { name: /Apply|\u5e94\u7528/ }));
    await waitFor(() => expect(lastUrl).toMatch(/token_name=myTok/));
    expect(lastUrl).toMatch(/[?&]p=1/);
  });
});
