import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { useChannelGroups } from './useChannelGroups';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Provider({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => server.resetHandlers());

describe('useChannelGroups', () => {
  test('normalizes map to sorted array, auto first', async () => {
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: {
            vip: { ratio: 2.0, desc: 'VIP' },
            auto: { ratio: '自动', desc: 'Auto routing' },
            default: { ratio: 1.0, desc: 'Default' },
          },
        })
      )
    );
    const { result } = renderHook(() => useChannelGroups(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: 'auto', ratio: '自动', desc: 'Auto routing' },
      { name: 'default', ratio: 1.0, desc: 'Default' },
      { name: 'vip', ratio: 2.0, desc: 'VIP' },
    ]);
  });

  test('empty map → empty array', async () => {
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({ success: true, data: {} })
      )
    );
    const { result } = renderHook(() => useChannelGroups(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  test('no auto → alphabetical only', async () => {
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: {
            zeta: { ratio: 1, desc: 'Z' },
            alpha: { ratio: 1, desc: 'A' },
          },
        })
      )
    );
    const { result } = renderHook(() => useChannelGroups(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((g) => g.name)).toEqual(['alpha', 'zeta']);
  });
});
