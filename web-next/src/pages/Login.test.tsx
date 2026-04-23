import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';

import { Login } from './Login';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login?redirect=/keys']}>
          <Routes>
            <Route path='/login' element={<Login />} />
            <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
            <Route path='/register' element={<div data-testid='register'>register</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('Login page', () => {
  test('happy path: submit -> navigate to redirect', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(document.getElementById('username') as HTMLInputElement, 'alice@example.com');
    await user.type(document.getElementById('password') as HTMLInputElement, 'good');
    await user.click(document.querySelector("button[type='submit']") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByTestId('keys')).toBeInTheDocument());
  });

  test('failure: wrong password shows inline banner', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(document.getElementById('username') as HTMLInputElement, 'alice@example.com');
    await user.type(document.getElementById('password') as HTMLInputElement, 'wrong');
    await user.click(document.querySelector("button[type='submit']") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/password|错误/i));
  });
});
