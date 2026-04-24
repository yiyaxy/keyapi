import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { ChannelFormDialog } from './ChannelFormDialog';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { role: 100, platform_role: 100 },
  }),
}));

vi.mock('@/hooks/useChannels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useChannels')>();
  return {
    ...actual,
    useAdminGroups: () => ({ data: [], isPending: false }),
    useChannelTypeModels: () => ({ data: {}, isPending: false }),
    useCreateChannel: () => ({
      mutateAsync: mockCreate,
      isPending: false,
      error: null,
    }),
    useUpdateChannel: () => ({
      mutateAsync: mockUpdate,
      isPending: false,
      error: null,
    }),
  };
});

function makeChannel(scope: 'platform' | 'tenant') {
  return {
    id: 1,
    tenant_id: 1,
    scope,
    type: 1,
    key: '',
    name: 'openai-main',
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
    markup_ratio: 1.25,
    platform_cost_ratio: 0.8,
  };
}

describe('ChannelFormDialog', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  test('shows platform-only pricing fields and serializes empty values to null', async () => {
    const user = userEvent.setup();

    render(
      <ChannelFormDialog
        open
        channel={makeChannel('platform')}
        onOpenChange={() => {}}
        forceScope='platform'
      />
    );

    const markupInput = screen.getByLabelText(/Default markup ratio|默认售价倍率/i);
    const platformCostInput = screen.getByLabelText(/Platform cost ratio|平台成本倍率/i);

    expect(markupInput).toHaveValue(1.25);
    expect(platformCostInput).toHaveValue(0.8);

    await user.clear(markupInput);
    await user.clear(platformCostInput);
    await user.click(screen.getByRole('button', { name: /save|保存/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0].input).toMatchObject({
      id: 1,
      markup_ratio: null,
      platform_cost_ratio: null,
    });
  });

  test('hides platform-only pricing fields for tenant channels', () => {
    render(<ChannelFormDialog open channel={makeChannel('tenant')} onOpenChange={() => {}} />);

    expect(screen.queryByLabelText(/Default markup ratio|默认售价倍率/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Platform cost ratio|平台成本倍率/i)).not.toBeInTheDocument();
  });
});
