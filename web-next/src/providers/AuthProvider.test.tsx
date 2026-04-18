import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { useAuth } from '@/hooks/useAuth';
import { server } from '@/test/msw/server';

import { AuthProvider } from './AuthProvider';

function Probe() {
  const { status, user, login, logout } = useAuth();
  return (
    <div>
      <div data-testid='status'>{status}</div>
      <div data-testid='user'>{user ? user.username : 'anon'}</div>
      <button onClick={() => void login({ username: 'alice', password: 'good' })}>login</button>
      <button onClick={() => void login({ username: 'alice', password: 'wrong' }).catch(() => {})}>
        bad-login
      </button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  server.resetHandlers();
});

describe('AuthProvider', () => {
  test('starts unauthenticated when no bootstrap', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
  });

  test('hydrates from bootstrap via /self', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
  });

  test('login success persists bootstrap and hydrates user', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(JSON.parse(localStorage.getItem('new-api.auth-bootstrap')!)).toEqual({
      id: 42,
      tenant_id: 1,
    });
  });

  test('login failure leaves state unauthenticated and throws', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
    await user.click(screen.getByText('bad-login'));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
  });

  test('logout clears bootstrap and user', async () => {
    const user = userEvent.setup();
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await user.click(screen.getByText('logout'));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
    expect(localStorage.getItem('new-api.auth-bootstrap')).toBeNull();
  });

  test('401 from /self treats user as unauthenticated', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 99, tenant_id: 1 }));
    server.use(
      http.get('/api/user/self', () =>
        HttpResponse.json({ success: false, message: 'unauthorized' }, { status: 401 })
      )
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    );
  });
});
