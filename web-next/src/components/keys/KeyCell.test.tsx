import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';
import { server } from '@/test/msw/server';

import { KeyCell } from './KeyCell';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});

describe('KeyCell', () => {
  test('toggle reveals full key then auto-hides after 5s', async () => {
    server.use(
      http.post('/api/token/1/key', () =>
        HttpResponse.json({ success: true, data: { key: 'sk-full-secret-1a2b3c' } })
      )
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    wrap(<KeyCell tokenId={1} masked='sk-••••1a2b' />);
    expect(screen.getByText('sk-••••1a2b')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reveal/i }));
    await waitFor(() => expect(screen.getByText('sk-full-secret-1a2b3c')).toBeInTheDocument());
    act(() => vi.advanceTimersByTime(5000));
    await waitFor(() => expect(screen.getByText('sk-••••1a2b')).toBeInTheDocument());
  });
});
