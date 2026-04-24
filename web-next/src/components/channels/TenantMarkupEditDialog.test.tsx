import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { TenantMarkupEditDialog } from './TenantMarkupEditDialog';

const mockUpsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/hooks/useTenantBilling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useTenantBilling')>();
  return {
    ...actual,
    useUpsertTenantPlatformChannelMarkup: () => ({
      mutateAsync: mockUpsert,
      isPending: false,
    }),
    useDeleteTenantPlatformChannelMarkup: () => ({
      mutateAsync: mockDelete,
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/usePublicConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/usePublicConfig')>();
  return {
    ...actual,
    usePublicConfig: () => ({
      quota_per_unit: 500_000,
      quota_display_type: 'USD' as const,
      usd_exchange_rate: 7,
      register_enabled: true,
      password_register_enabled: true,
      password_login_enabled: true,
      email_verification: true,
    }),
  };
});

function makeChannel() {
  return {
    id: 7,
    tenant_id: 1,
    scope: 'platform' as const,
    type: 1,
    key: '',
    name: 'shared-openai',
    status: 1,
    weight: 0,
    created_time: 1,
    test_time: 0,
    response_time: 100,
    base_url: '',
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: 'gpt-4o',
    group: 'default',
    used_quota: 0,
    priority: 1,
    auto_ban: 1,
    max_retry: 0,
    tag: null,
    remark: null,
    openai_organization: null,
    test_model: null,
    model_mapping: null,
    status_code_mapping: null,
    param_override: null,
    header_override: null,
    setting: JSON.stringify({ channel_ratio: 1 }),
    markup_ratio: 1.3,
  };
}

const pricingRows = [
  {
    model_name: 'gpt-4o',
    quota_type: 0,
    model_ratio: 10,
    model_price: 0,
    owner_by: 'OpenAI',
    completion_ratio: 2,
  },
];

describe('TenantMarkupEditDialog', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDelete.mockReset();
    mockUpsert.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
  });

  test('updates the formula pill and preview matrix when the input changes', async () => {
    const user = userEvent.setup();

    render(
      <TenantMarkupEditDialog
        open
        channel={makeChannel()}
        override={undefined}
        planMarkup={1.5}
        pricingRows={pricingRows}
        groupRatios={{ default: 1 }}
        onOpenChange={() => {}}
      />
    );

    const input = screen.getByRole('spinbutton', { name: /Markup ratio|售价倍率/i });
    await user.clear(input);
    await user.type(input, '2');

    expect(screen.getByRole('button', { name: /My markup 2x|我的倍率 2x/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('$40.00')).toBeInTheDocument());
  });

  test('adds extra group columns and clears an existing override', async () => {
    const user = userEvent.setup();

    render(
      <TenantMarkupEditDialog
        open
        channel={makeChannel()}
        override={{
          tenant_id: 1,
          channel_id: 7,
          markup_ratio: 1.8,
          enabled: true,
          created_at: 1,
          updated_at: 1,
        }}
        planMarkup={1.5}
        pricingRows={pricingRows}
        groupRatios={{ default: 1, vip: 0.5 }}
        onOpenChange={() => {}}
      />
    );

    await user.click(screen.getByLabelText(/Expand other groups|展开其他分组/i));
    await user.click(screen.getByRole('button', { name: /Select groups|选择分组/i }));
    await user.click(screen.getByText('vip'));

    expect(await screen.findByText(/vip 0\.5x/i)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Clear override|清除覆盖/i })[0]);

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(7));
  });

  test('always surfaces the channel_ratio pill and extra section even when value is 1x', async () => {
    render(
      <TenantMarkupEditDialog
        open
        channel={makeChannel()}
        override={undefined}
        planMarkup={1}
        pricingRows={pricingRows}
        groupRatios={{ default: 1 }}
        onOpenChange={() => {}}
      />
    );

    // Pill chain in the formula preview shows the channel_ratio pill even
    // though the value is 1x (forceShowChannelRatio=true is passed by the
    // dialog so tenants can see the hidden platform multiplier exists).
    expect(
      screen.getByRole('button', { name: /Channel ratio 1x|渠道倍率 1x/i })
    ).toBeInTheDocument();

    // Extra section under priority chain makes the "platform-only, not
    // tenant-overridable" semantic explicit.
    expect(
      screen.getByText(/Platform also applies on this channel|此外平台对该渠道另加/i)
    ).toBeInTheDocument();
  });

  test('opens a confirmation dialog when the input matches the plan default', async () => {
    const user = userEvent.setup();

    render(
      <TenantMarkupEditDialog
        open
        channel={makeChannel()}
        override={undefined}
        planMarkup={1.5}
        pricingRows={pricingRows}
        groupRatios={{ default: 1 }}
        onOpenChange={() => {}}
      />
    );

    const input = screen.getByRole('spinbutton', { name: /Markup ratio|售价倍率/i });
    await user.clear(input);
    await user.type(input, '1.5');
    await user.click(screen.getByRole('button', { name: /^Save$|^保存$/i }));

    expect(
      await screen.findByText(/Keep or clear this override|保留还是清除这个覆盖/i)
    ).toBeInTheDocument();
  });
});
