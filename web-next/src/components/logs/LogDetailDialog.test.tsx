import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { LogDetailDialog } from './LogDetailDialog';

const log = {
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
    tenant_markup_ratio: 1.6,
    markup_source: 'tenant_channel',
    platform_cost_quota: 250000,
  }),
};

describe('LogDetailDialog', () => {
  test('shows tenant-facing markup fields without exposing admin-only raw JSON', () => {
    render(<LogDetailDialog open log={log} onOpenChange={() => {}} />);

    expect(screen.getByText('1.6x')).toBeInTheDocument();
    expect(screen.getByText(/Custom override|自定义覆盖/)).toBeInTheDocument();
    expect(screen.queryByText(/platform_cost_quota/i)).not.toBeInTheDocument();
  });

  test('keeps the raw payload visible for admins', () => {
    render(<LogDetailDialog open log={log} isAdmin onOpenChange={() => {}} />);

    expect(screen.getByText(/platform_cost_quota/)).toBeInTheDocument();
  });
});
