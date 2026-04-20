import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { InlineBanner } from './InlineBanner';

describe('InlineBanner', () => {
  test('renders message and role=alert', () => {
    render(<InlineBanner level='danger' message='boom' />);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('boom');
  });

  test('close calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InlineBanner level='danger' message='boom' onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
