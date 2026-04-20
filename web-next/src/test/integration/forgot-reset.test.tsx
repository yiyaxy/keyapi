import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { Forgot } from '@/pages/Forgot';
import { Reset } from '@/pages/Reset';

describe('integration: forgot → reset', () => {
  test('send reset email → visit /user/reset with token → submit → see new password', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/forgot']}>
        <Routes>
          <Route path='/forgot' element={<Forgot />} />
        </Routes>
      </MemoryRouter>
    );
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await waitFor(() => expect(screen.getByText(/inbox|收件箱/i)).toBeInTheDocument());
    unmount();

    render(
      <MemoryRouter initialEntries={['/user/reset?email=alice@example.com&token=abcd']}>
        <Routes>
          <Route path='/user/reset' element={<Reset />} />
          <Route path='/login' element={<div data-testid='login'>login</div>} />
        </Routes>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: /重置|reset/i }));
    await waitFor(() => expect(screen.getByText('Gx7kPq2mN9vR')).toBeInTheDocument());
  });
});
