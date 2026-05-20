import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';
import type { FieldDef } from '@/lib/settingsSchema';

import type { FieldMutation } from './FieldRows';
import { KvMapEditor } from './KvMapEditor';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeMutation(): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
  return { mutate: vi.fn(), isPending: false } as FieldMutation & {
    mutate: ReturnType<typeof vi.fn>;
  };
}

const groupRatioField: FieldDef = {
  key: 'GroupRatio',
  kind: 'kvMap',
  label: { zh: '分组倍率', en: 'Group ratio' },
  kvValueType: 'number',
};

describe('KvMapEditor', () => {
  test('未覆盖时按钮文案是"固化为租户值"且可点击', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <KvMapEditor
        field={groupRatioField}
        value='{"default":1}'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const btn = screen.getByRole('button', { name: '固化为租户值' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(mutation.mutate).toHaveBeenCalledWith(
      { key: 'GroupRatio', value: '{"default":1}' },
      expect.any(Object)
    );
  });

  test('已覆盖且未改值时按钮 disabled，文案是"已保存"', () => {
    const mutation = makeMutation();
    wrap(
      <KvMapEditor
        field={groupRatioField}
        value='{"default":1}'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: true, onReset: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });
});
