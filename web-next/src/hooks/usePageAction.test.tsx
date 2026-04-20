import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { describe, expect, test } from 'vitest';

import { PageAction, registerPageActionSlot } from './usePageAction';

function Host({ children }: { children: React.ReactNode }) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    registerPageActionSlot(slotRef.current);
    return () => registerPageActionSlot(null);
  }, []);
  return (
    <div>
      <header data-testid='header'>
        <div ref={slotRef} />
      </header>
      {children}
    </div>
  );
}

function PageWithAction() {
  return (
    <div>
      <PageAction>
        <button data-testid='page-btn'>Do thing</button>
      </PageAction>
      <div data-testid='page'>page</div>
    </div>
  );
}

describe('PageAction portal', () => {
  test('portals action into registered slot', async () => {
    render(
      <Host>
        <PageWithAction />
      </Host>
    );
    await waitFor(() => expect(screen.getByTestId('page-btn')).toBeInTheDocument());
    expect(screen.getByTestId('header')).toContainElement(screen.getByTestId('page-btn'));
  });
});
