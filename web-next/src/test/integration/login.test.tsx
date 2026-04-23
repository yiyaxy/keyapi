import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Login } from '@/pages/Login';
import { AuthProvider } from '@/providers/AuthProvider';

function mount(entry = '/login?redirect=/dashboard') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path='/login' element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path='/dashboard' element={<ComingSoon feature='Dashboard' />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('integration: login flow', () => {
  test('sign in -> bootstrap saved -> /self -> dashboard ComingSoon visible', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(document.getElementById('username') as HTMLInputElement, 'alice@example.com');
    await user.type(document.getElementById('password') as HTMLInputElement, 'good');
    await user.click(document.querySelector("button[type='submit']") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('new-api.auth-bootstrap')!)).toEqual({
      id: 42,
      tenant_id: 1,
    });
  });
});
