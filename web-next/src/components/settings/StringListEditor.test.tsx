import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';
import type { FieldDef } from '@/lib/settingsSchema';

import type { FieldMutation } from './FieldRows';
import { StringListEditor } from './StringListEditor';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeMutation(): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
  return { mutate: vi.fn(), isPending: false } as FieldMutation & {
    mutate: ReturnType<typeof vi.fn>;
  };
}

const sensitiveWordsField: FieldDef = {
  key: 'SensitiveWords',
  kind: 'stringList',
  label: { zh: '敏感词', en: 'Sensitive words' },
};

describe('StringListEditor', () => {
  test('未覆盖时按钮文案是"固化为租户值"且可点击', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <StringListEditor
        field={sensitiveWordsField}
        value='["spam"]'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const btn = screen.getByRole('button', { name: '固化为租户值' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(mutation.mutate).toHaveBeenCalledWith(
      { key: 'SensitiveWords', value: '["spam"]' },
      expect.any(Object)
    );
  });

  test('已覆盖且未改时按钮 disabled，文案是"已保存"', () => {
    const mutation = makeMutation();
    wrap(
      <StringListEditor
        field={sensitiveWordsField}
        value='["spam"]'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: true, onReset: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });
});
