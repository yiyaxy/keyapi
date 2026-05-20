import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';
import type { FieldDef } from '@/lib/settingsSchema';

import { BoolRow, SecretRow, SelectRow, TextRow, type FieldMutation } from './FieldRows';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeMutation(
  overrides: Partial<FieldMutation> = {}
): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as FieldMutation & { mutate: ReturnType<typeof vi.fn> };
}

const smtpServerField: FieldDef = {
  key: 'SMTPServer',
  kind: 'text',
  label: { zh: 'SMTP 服务器', en: 'SMTP host' },
};

describe('TextRow', () => {
  test('未覆盖且未改值时，按钮文案是"固化为租户值"且可点击', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <TextRow
        field={smtpServerField}
        value='smtp.qq.com'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const btn = screen.getByRole('button', { name: '固化为租户值' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(mutation.mutate).toHaveBeenCalledWith(
      { key: 'SMTPServer', value: 'smtp.qq.com' },
      expect.any(Object)
    );
  });

  test('未覆盖但改了值，按钮文案变成"保存"', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <TextRow
        field={smtpServerField}
        value='smtp.qq.com'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const input = screen.getByDisplayValue('smtp.qq.com');
    await user.clear(input);
    await user.type(input, 'smtp.example.com');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  test('已覆盖且未改值，按钮 disabled，文案是"已保存"', () => {
    const mutation = makeMutation();
    wrap(
      <TextRow
        field={smtpServerField}
        value='smtp.qq.com'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: true, onReset: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });

  test('未传 overrideMeta（平台后台场景），按钮 disabled', () => {
    const mutation = makeMutation();
    wrap(
      <TextRow
        field={smtpServerField}
        value='smtp.qq.com'
        onSaved={() => {}}
        mutation={mutation}
      />
    );
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled();
  });
});

const drawingEnabledField: FieldDef = {
  key: 'DrawingEnabled',
  kind: 'bool',
  label: { zh: '启用绘图', en: 'Drawing enabled' },
};

describe('BoolRow', () => {
  test('未覆盖时渲染"固化为租户值"按钮，点击提交当前 value', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <BoolRow
        field={drawingEnabledField}
        value='true'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const btn = screen.getByRole('button', { name: '固化为租户值' });
    await user.click(btn);
    expect(mutation.mutate).toHaveBeenCalledWith(
      { key: 'DrawingEnabled', value: 'true' },
      expect.any(Object)
    );
  });

  test('已覆盖时不渲染"固化"按钮', () => {
    const mutation = makeMutation();
    wrap(
      <BoolRow
        field={drawingEnabledField}
        value='true'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: true, onReset: () => {} }}
      />
    );
    expect(screen.queryByRole('button', { name: '固化为租户值' })).not.toBeInTheDocument();
  });

  test('未传 overrideMeta（平台后台）不渲染"固化"按钮', () => {
    const mutation = makeMutation();
    wrap(
      <BoolRow
        field={drawingEnabledField}
        value='true'
        onSaved={() => {}}
        mutation={mutation}
      />
    );
    expect(screen.queryByRole('button', { name: '固化为租户值' })).not.toBeInTheDocument();
  });
});

const quotaDisplayField: FieldDef = {
  key: 'general_setting.quota_display_type',
  kind: 'select',
  label: { zh: '额度显示', en: 'Quota display' },
  options: [
    { value: 'usd', label: { zh: '美元', en: 'USD' } },
    { value: 'cny', label: { zh: '人民币', en: 'CNY' } },
  ],
};

describe('SelectRow', () => {
  test('未覆盖时渲染"固化为租户值"按钮，点击提交当前 value', async () => {
    const mutation = makeMutation();
    const user = userEvent.setup();
    wrap(
      <SelectRow
        field={quotaDisplayField}
        value='cny'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    const btn = screen.getByRole('button', { name: '固化为租户值' });
    await user.click(btn);
    expect(mutation.mutate).toHaveBeenCalledWith(
      { key: 'general_setting.quota_display_type', value: 'cny' },
      expect.any(Object)
    );
  });

  test('已覆盖时不渲染"固化"按钮', () => {
    const mutation = makeMutation();
    wrap(
      <SelectRow
        field={quotaDisplayField}
        value='cny'
        onSaved={() => {}}
        mutation={mutation}
        overrideMeta={{ isOverridden: true, onReset: () => {} }}
      />
    );
    expect(screen.queryByRole('button', { name: '固化为租户值' })).not.toBeInTheDocument();
  });

  test('未传 overrideMeta 不渲染"固化"按钮', () => {
    const mutation = makeMutation();
    wrap(
      <SelectRow
        field={quotaDisplayField}
        value='cny'
        onSaved={() => {}}
        mutation={mutation}
      />
    );
    expect(screen.queryByRole('button', { name: '固化为租户值' })).not.toBeInTheDocument();
  });
});

const smtpTokenField: FieldDef = {
  key: 'SMTPToken',
  kind: 'secret',
  label: { zh: 'SMTP 授权码', en: 'SMTP token' },
};

describe('SecretRow', () => {
  test('即使未覆盖也不渲染"固化"按钮（无法固化未知明文）', () => {
    const mutation = makeMutation();
    wrap(
      <SecretRow
        field={smtpTokenField}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    expect(screen.queryByRole('button', { name: '固化为租户值' })).not.toBeInTheDocument();
  });

  test('保存按钮在 draft 为空时 disabled', () => {
    const mutation = makeMutation();
    wrap(
      <SecretRow
        field={smtpTokenField}
        mutation={mutation}
        overrideMeta={{ isOverridden: false, onReset: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
});
