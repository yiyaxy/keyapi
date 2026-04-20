import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import type { Token } from '@/hooks/useTokens';
import { server } from '@/test/msw/server';

import { EditTokenSheet } from './EditTokenSheet';

const token: Token = {
  id: 1,
  name: 'initial',
  status: 1,
  remain_quota: 1000,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 1713484800,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  group: 'auto',
  cross_group_retry: false,
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => server.resetHandlers());

describe('EditTokenSheet', () => {
  test('submits PUT body with name change', async () => {
    let puttedBody: unknown = null;
    server.use(
      http.get('/api/user/models', () => HttpResponse.json({ success: true, data: [] })),
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: { auto: { ratio: '自动', desc: 'Auto' } },
        })
      ),
      http.put('/api/token/', async ({ request }) => {
        puttedBody = await request.json();
        return HttpResponse.json({ success: true, data: { id: 1 } });
      })
    );
    const user = userEvent.setup();
    wrap(<EditTokenSheet open token={token} onOpenChange={() => {}} />);
    const nameInput = await screen.findByLabelText(/Name|名称/);
    await user.clear(nameInput);
    await user.type(nameInput, 'updated');
    await user.click(screen.getByRole('button', { name: /^Save$|^保存$/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(puttedBody).toMatchObject({ id: 1, name: 'updated' });
  });
});
