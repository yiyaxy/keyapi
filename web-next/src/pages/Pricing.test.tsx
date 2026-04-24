import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { PricingPage } from './Pricing';

const mockUseAuth = vi.fn();
const mockUsePricing = vi.fn();
const mockUsePublicConfig = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/usePricing', () => ({
  usePricing: () => mockUsePricing(),
}));

vi.mock('@/hooks/usePublicConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/usePublicConfig')>();
  return {
    ...actual,
    usePublicConfig: () => mockUsePublicConfig(),
  };
});

function findRow(modelName: string) {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(modelName));

  if (!row) {
    throw new Error(`Row not found for model ${modelName}`);
  }

  return row;
}

describe('PricingPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { group: 'default' },
      status: 'authenticated',
    });
    mockUsePublicConfig.mockReturnValue({
      quota_per_unit: 500_000,
      quota_display_type: 'USD',
      usd_exchange_rate: 7,
      register_enabled: true,
      password_register_enabled: true,
      password_login_enabled: true,
      email_verification: true,
    });
    mockUsePricing.mockReturnValue({
      data: {
        data: [
          {
            model_name: 'gpt-5.4',
            quota_type: 0,
            model_ratio: 10,
            model_price: 0,
            owner_by: 'OpenAI',
            completion_ratio: 2,
            enable_groups: ['default', 'vip'],
            vendor_id: 1,
          },
        ],
        vendors: [{ id: 1, name: 'OpenAI' }],
        group_ratio: { default: 1, vip: 1.2 },
        usable_group: { default: '默认分组', vip: 'VIP 分组' },
        auto_groups: [],
        supported_endpoint: {},
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  test('renders every enabled group inside the table row', () => {
    render(<PricingPage />);

    const row = findRow('gpt-5.4');
    expect(within(row).getByText('默认分组')).toBeInTheDocument();
    expect(within(row).getByText('VIP 分组')).toBeInTheDocument();
    expect(within(row).getByText('1x')).toBeInTheDocument();
    expect(within(row).getByText('1.2x')).toBeInTheDocument();
  });

  test('marks only the selected pricing group as active', () => {
    render(<PricingPage />);

    const row = findRow('gpt-5.4');
    const defaultTag = within(row).getByText('默认分组').closest('[data-group]') as HTMLElement;
    const vipTag = within(row).getByText('VIP 分组').closest('[data-group]') as HTMLElement;

    expect(defaultTag).toHaveAttribute('data-selected', 'true');
    expect(vipTag).toHaveAttribute('data-selected', 'false');
  });
});
