import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';

import type { Channel } from '@/hooks/useChannels';

import { ChannelsTable } from './ChannelsTable';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 1,
    tenant_id: 1,
    scope: 'platform',
    type: 1,
    key: '',
    name: 'platform-openai',
    status: 1,
    weight: 0,
    created_time: 1,
    test_time: 0,
    response_time: 120,
    base_url: '',
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: 'gpt-4o, claude-3-5-sonnet, gpt-4o-mini',
    group: 'default',
    used_quota: 0,
    priority: 10,
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
    setting: null,
    ...overrides,
  };
}

function renderTable(showModels: boolean) {
  return render(
    <ChannelsTable
      items={[makeChannel()]}
      testingId={null}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onToggle={vi.fn()}
      onTest={vi.fn()}
      showModels={showModels}
    />
  );
}

describe('ChannelsTable', () => {
  test('renders models only when the model column is enabled', () => {
    const { rerender } = renderTable(true);

    expect(screen.getByText('gpt-4o, claude-3-5-sonnet, gpt-4o-mini')).toBeInTheDocument();

    rerender(
      <ChannelsTable
        items={[makeChannel()]}
        testingId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
        onTest={vi.fn()}
      />
    );

    expect(screen.queryByText('gpt-4o, claude-3-5-sonnet, gpt-4o-mini')).not.toBeInTheDocument();
  });
});
