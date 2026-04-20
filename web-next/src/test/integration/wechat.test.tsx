import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Login } from '@/pages/Login';
import { AuthProvider } from '@/providers/AuthProvider';

describe('integration: WeChat code login', () => {
  test('click WeChat → enter code → dashboard ComingSoon', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path='/login' element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path='/' element={<ComingSoon feature='Dashboard' />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await user.click(await screen.findByRole('button', { name: /wechat/i }));
    await user.type(await screen.findByLabelText(/wechat code/i), 'ok-code');
    await user.click(screen.getByRole('button', { name: /继续|continue/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
  });
});
