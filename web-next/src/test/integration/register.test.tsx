import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Register } from '@/pages/Register';
import { AuthProvider } from '@/providers/AuthProvider';

describe('integration: register flow', () => {
  test('two-step form → auto-login → dashboard ComingSoon', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path='/register' element={<Register />} />
            <Route element={<ProtectedRoute />}>
              <Route path='/' element={<ComingSoon feature='Dashboard' />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await user.type(await screen.findByLabelText(/验证码|code/i), '123456');
    await user.type(screen.getByLabelText(/用户名|username/i), 'alice');
    await user.type(screen.getByLabelText(/^设置密码|^password$/i), 'Abcdef1234!@');
    await user.type(screen.getByLabelText(/确认密码|confirm/i), 'Abcdef1234!@');
    await user.click(screen.getByRole('button', { name: /创建|create/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
  });
});
