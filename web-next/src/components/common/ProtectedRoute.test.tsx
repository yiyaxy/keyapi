import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import { AuthProvider } from '@/providers/AuthProvider';

import { ProtectedRoute } from './ProtectedRoute';

describe('ProtectedRoute', () => {
  test('redirects to /login?redirect=… when unauthenticated', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route path='/login' element={<div data-testid='login'>login</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
  });

  test('renders outlet when authenticated', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('keys')).toBeInTheDocument());
  });
});
