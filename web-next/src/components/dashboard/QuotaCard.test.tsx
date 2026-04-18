import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { QuotaCard } from './QuotaCard';

function Wrap(u: { quota: number; used_quota: number }) {
  return (
    <MemoryRouter>
      <QuotaCard user={u} />
    </MemoryRouter>
  );
}

describe('QuotaCard', () => {
  test('shows top-up CTA when brand new (both zero)', () => {
    render(Wrap({ quota: 0, used_quota: 0 }));
    expect(screen.getByRole('button', { name: /Top up|充值/ })).toBeInTheDocument();
  });

  test('shows balance when user has quota', () => {
    render(Wrap({ quota: 50_000_000, used_quota: 50_000_000 }));
    expect(screen.getByText(/Used \$100\.00 of \$200\.00/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$100\.00/).length).toBeGreaterThan(0);
  });

  test('shows Exhausted badge when quota=0 but has history', () => {
    render(Wrap({ quota: 0, used_quota: 10_000_000 }));
    expect(screen.getByText(/Exhausted|已耗尽/)).toBeInTheDocument();
  });
});
