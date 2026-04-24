import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { CostBreakdown } from './CostBreakdown';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 10, platform_role: 10, tenant_role: 10 },
  }),
}));

const cfg = {
  quota_per_unit: 500_000,
  quota_display_type: 'USD' as const,
  usd_exchange_rate: 7,
  register_enabled: true,
  password_register_enabled: true,
  password_login_enabled: true,
  email_verification: true,
};

const row = {
  id: 1,
  tenant_id: 1,
  user_id: 2,
  created_at: 1_713_484_800,
  type: 2 as const,
  content: 'hello',
  username: 'user',
  token_name: 'tok',
  model_name: 'gpt-4o',
  quota: 500_000,
  prompt_tokens: 100,
  completion_tokens: 200,
  use_time: 123,
  is_stream: false,
  channel: 7,
  channel_name: 'shared-openai',
  token_id: 5,
  group: 'default',
  ip: '127.0.0.1',
  request_id: 'req-1',
  other: JSON.stringify({
    model_ratio: 10,
    completion_ratio: 1,
    group_ratio: 1,
    markup_ratio: 1.2,
    pricing_version: 'dual-ledger-v1',
    user_bill_quota: 500000,
    platform_cost_quota: 250000,
    platform_cost_channel_ratio: 0.8,
    platform_channel: true,
  }),
};

describe('CostBreakdown', () => {
  test('shows the platform cost ledger section for dual-ledger admin rows', async () => {
    const user = userEvent.setup();

    render(
      <CostBreakdown row={row} cfg={cfg}>
        <span>details</span>
      </CostBreakdown>
    );

    await user.click(screen.getByText('details'));

    expect(await screen.findByText(/Platform cost ledger|平台成本账/)).toBeInTheDocument();
    expect(screen.getByText(/Platform shared|平台共享/)).toBeInTheDocument();
    expect(screen.getByText(/User bill -> Platform cost|用户账单 -> 平台成本/)).toBeInTheDocument();
  });
});
