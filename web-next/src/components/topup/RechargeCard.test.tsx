import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthContext, type AuthContextValue } from '@/hooks/useAuth';
import { server } from '@/test/msw/server';

import { RechargeCard } from './RechargeCard';

afterEach(() => {
  server.resetHandlers();
});

const authValue: AuthContextValue = {
  user: null,
  status: 'authenticated',
  refresh: async () => {},
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={authValue}>
        <RechargeCard />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('RechargeCard', () => {
  test('switches to the token preset once public config resolves', async () => {
    server.use(
      http.get('/api/status', async () => {
        await delay(50);
        return HttpResponse.json({
          success: true,
          data: {
            quota_per_unit: 500_000,
            quota_display_type: 'TOKENS',
            usd_exchange_rate: 7,
            price: 7,
            custom_currency_symbol: '¤',
            custom_currency_exchange_rate: 1,
          },
        });
      })
    );

    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Total|需支付/).parentElement).toHaveTextContent('2,500,000')
    );
  });

  test('uses Price for the payment estimate', async () => {
    server.use(
      http.get('/api/status', () =>
        HttpResponse.json({
          success: true,
          data: {
            quota_per_unit: 500_000,
            quota_display_type: 'USD',
            usd_exchange_rate: 7.3,
            price: 9.9,
            custom_currency_symbol: '¤',
            custom_currency_exchange_rate: 1,
          },
        })
      )
    );

    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/(WeChat will charge|实际扫码金额约).*49\.50/)).toBeInTheDocument()
    );
  });
});
