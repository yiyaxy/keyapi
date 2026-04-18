import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';

import { Login } from './Login';

function mount() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login?redirect=/keys']}>
        <Routes>
          <Route path='/login' element={<Login />} />
          <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
          <Route path='/register' element={<div data-testid='register'>register</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Login page', () => {
  test('happy path: submit → navigate to redirect', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'good');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() => expect(screen.getByTestId('keys')).toBeInTheDocument());
  });

  test('failure: wrong password shows inline banner', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/密码错误|password/)
    );
  });
});
