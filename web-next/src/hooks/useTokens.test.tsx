import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { useCreateToken, useTokensQuery, useUpdateToken } from './useTokens';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Provider({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => server.resetHandlers());

describe('useTokensQuery', () => {
  test('returns items and total', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: { items: [{ id: 1, name: 'a' }], total: 1 },
        })
      )
    );
    const { result } = renderHook(() => useTokensQuery(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ id: 1, name: 'a' }]);
    expect(result.current.data?.total).toBe(1);
  });
});

describe('useCreateToken', () => {
  test('POST /api/token/ with unlimited defaults', async () => {
    let postedBody: unknown = null;
    server.use(
      http.post('/api/token/', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({ success: true, message: '' });
      })
    );
    const { result } = renderHook(() => useCreateToken(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ name: 'new', group: 'auto' });
    });
    expect(postedBody).toMatchObject({
      name: 'new',
      group: 'auto',
      unlimited_quota: true,
      remain_quota: 0,
      expired_time: -1,
    });
  });
});

describe('useUpdateToken', () => {
  test('PUT body passes through', async () => {
    let put: unknown = null;
    server.use(
      http.put('/api/token/', async ({ request }) => {
        put = await request.json();
        return HttpResponse.json({ success: true, data: { id: 1 } });
      })
    );
    const { result } = renderHook(() => useUpdateToken(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, name: 'updated' });
    });
    expect(put).toMatchObject({ id: 1, name: 'updated' });
  });
});
