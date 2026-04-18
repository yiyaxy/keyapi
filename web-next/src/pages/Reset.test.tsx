import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { Reset } from './Reset';

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/reset' element={<Reset />} />
        <Route path='/user/reset' element={<Reset />} />
        <Route path='/forgot' element={<div data-testid='forgot'>forgot</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Reset page', () => {
  test('missing token redirects to /forgot', async () => {
    mount('/reset?email=a@b.com');
    await waitFor(() => expect(screen.getByTestId('forgot')).toBeInTheDocument());
  });

  test('submit shows server-generated password', async () => {
    const user = userEvent.setup();
    mount('/user/reset?email=a@b.com&token=abcd');
    await user.click(await screen.findByRole('button', { name: /重置|reset/i }));
    await waitFor(() => expect(screen.getByText('Gx7kPq2mN9vR')).toBeInTheDocument());
  });
});
