import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';

import { Register } from './Register';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path='/register' element={<Register />} />
            <Route path='/' element={<div data-testid='home'>home</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('Register page', () => {
  test('two-step: send code → fill form → submit → auto-login → navigate /', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await waitFor(() => screen.getByLabelText(/验证码|code/i));
    await user.type(screen.getByLabelText(/验证码|code/i), '123456');
    await user.type(screen.getByLabelText(/用户名|username/i), 'alice');
    await user.type(screen.getByLabelText(/^设置密码|^password$/i), 'Abcdef1234!@');
    await user.type(screen.getByLabelText(/确认密码|confirm/i), 'Abcdef1234!@');
    await user.click(screen.getByRole('button', { name: /创建|create/i }));
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });
});
