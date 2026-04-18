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
  return render(
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
  );
}

describe('integration: login flow', () => {
  test('sign in → bootstrap saved → /self → dashboard ComingSoon visible', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'good');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('new-api.auth-bootstrap')!)).toEqual({
      id: 42,
      tenant_id: 1,
    });
  });
});
