import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { ApiError, api } from './api';

afterEach(() => server.resetHandlers());

describe('api client', () => {
  test('unwraps success: true payload', async () => {
    server.use(
      http.get('/api/ping', () => HttpResponse.json({ success: true, data: { pong: true } }))
    );
    await expect(api.get('/api/ping').then((r) => r.data)).resolves.toEqual({ pong: true });
  });

  test('throws ApiError on success: false', async () => {
    server.use(
      http.get('/api/fail', () => HttpResponse.json({ success: false, message: '坏了' }))
    );
    await expect(api.get('/api/fail')).rejects.toMatchObject({
      name: 'ApiError',
      backendMessage: '坏了',
    });
  });

  test('throws ApiError with code=server_error on 500', async () => {
    server.use(http.get('/api/boom', () => HttpResponse.json({}, { status: 500 })));
    await expect(api.get('/api/boom')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'server_error',
    });
  });

  test('injects New-API-User header from bootstrap', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 99, tenant_id: 2 }));
    let seen: string | null = null;
    server.use(
      http.get('/api/whoami', ({ request }) => {
        seen = request.headers.get('new-api-user');
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await api.get('/api/whoami');
    expect(seen).toBe('99');
  });

  test('omits New-API-User when no bootstrap', async () => {
    let seen: string | null = null;
    server.use(
      http.get('/api/whoami2', ({ request }) => {
        seen = request.headers.get('new-api-user');
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await api.get('/api/whoami2');
    expect(seen).toBeNull();
  });

  test('ApiError.fromBody defaults code to unknown', () => {
    const e = ApiError.fromBody({ message: 'oops' });
    expect(e.code).toBe('unknown');
    expect(e.backendMessage).toBe('oops');
  });
});
