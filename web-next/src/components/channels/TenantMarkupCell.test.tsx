import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { TenantMarkupCell } from './TenantMarkupCell';

function makeChannel(setting: unknown = { channel_ratio: 1 }) {
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
    setting: JSON.stringify(setting),
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

describe('TenantMarkupCell', () => {
  test('renders the custom source badge and group ratio tooltip', async () => {
    render(
      <TenantMarkupCell
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
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText(/Custom|自定义/)).toBeInTheDocument();
    expect(screen.getByText('1.8x')).toBeInTheDocument();

    screen.getByRole('button', { name: /Group ratio|分组倍率/i }).focus();

    expect((await screen.findAllByText('default')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('vip').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.5x').length).toBeGreaterThan(0);
  });

  test('falls back to the plan source and omits the neutral channel ratio pill', () => {
    render(
      <TenantMarkupCell
        channel={{ ...makeChannel(), markup_ratio: null }}
        planMarkup={1.4}
        pricingRows={pricingRows}
        groupRatios={{ default: 1 }}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText(/Plan default|套餐默认/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Channel ratio|渠道倍率/i })
    ).not.toBeInTheDocument();
  });
});
