# 租户配置"固化为租户值"按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复租户后台无法把"看上去是平台默认"的字段保存成租户级覆盖的 bug——为 TextRow / BoolRow / SelectRow / KvMapEditor / StringListEditor 添加"固化为租户值"动作。

**Architecture:** 前端纯改动。引入 `canForceOverride = !!overrideMeta && !overrideMeta.isOverridden` 概念，让保存按钮在"无 diff 但未覆盖"时仍可提交当前展示值；对 onChange 即存的控件（Bool/Select）追加独立"固化"按钮。后端 / 路由 / 多机 Redis 同步均无需改动。

**Tech Stack:** React 18 / vitest / @testing-library/react / react-i18next / @tanstack/react-query

**Spec:** `docs/superpowers/specs/2026-05-20-tenant-config-force-override-design.md`

**测试运行命令（每次跑测试时用这一条）：**

```powershell
bun --cwd web-next test -- --run web-next/src/components/settings/FieldRows.test.tsx
```

若 `bun` 不可用，回退用 npm：

```powershell
npm --prefix web-next test -- --run web-next/src/components/settings/FieldRows.test.tsx
```

整体跑全部 web-next 测试：

```powershell
bun --cwd web-next test
```

---

## File Structure

**修改：**

- `web-next/src/i18n/locales/zh/settings.json` — 加 `action.force_override`
- `web-next/src/i18n/locales/en/settings.json` — 加 `action.force_override`
- `web-next/src/components/settings/FieldRows.tsx` — TextRow / BoolRow / SelectRow 改造；SecretRow 不动
- `web-next/src/components/settings/KvMapEditor.tsx` — 保存按钮 disabled / 文案改造
- `web-next/src/components/settings/StringListEditor.tsx` — 同上

**新建：**

- `web-next/src/components/settings/FieldRows.test.tsx` — TextRow / BoolRow / SelectRow / SecretRow 行为测试
- `web-next/src/components/settings/KvMapEditor.test.tsx` — happy-path
- `web-next/src/components/settings/StringListEditor.test.tsx` — happy-path

测试默认语言为 `zh`（i18n `fallbackLng: 'zh'`，setup.ts 每个用例后 `localStorage.clear()`），按钮文案断言用中文字面量。

---

## Task 1：添加 i18n 文案 key

**Files:**

- Modify: `web-next/src/i18n/locales/zh/settings.json`
- Modify: `web-next/src/i18n/locales/en/settings.json`

- [ ] **Step 1.1：加中文文案**

在 `web-next/src/i18n/locales/zh/settings.json` 的 `"action.reset"` 一行之后插入：

```json
  "action.force_override": "固化为租户值",
```

完整片段应为：

```json
  "action.save": "保存",
  "action.saved": "已保存",
  "action.saving": "保存中…",
  "action.revert": "还原",
  "action.reset": "恢复默认",
  "action.force_override": "固化为租户值",
  "action.force_logout": "强制所有用户登出",
```

- [ ] **Step 1.2：加英文文案**

在 `web-next/src/i18n/locales/en/settings.json` 的 `"action.reset"` 一行之后插入：

```json
  "action.force_override": "Lock as tenant value",
```

完整片段应为：

```json
  "action.save": "Save",
  "action.saved": "Saved",
  "action.saving": "Saving…",
  "action.revert": "Revert",
  "action.reset": "Reset to default",
  "action.force_override": "Lock as tenant value",
  "action.force_logout": "Force all users to log out",
```

- [ ] **Step 1.3：commit**

```bash
git -C D:/top/keyapi add web-next/src/i18n/locales/zh/settings.json web-next/src/i18n/locales/en/settings.json
git -C D:/top/keyapi commit -m "i18n(settings): add action.force_override for tenant force-save"
```

---

## Task 2：TextRow 支持"固化为租户值"（TDD）

**Files:**

- Create: `web-next/src/components/settings/FieldRows.test.tsx`
- Modify: `web-next/src/components/settings/FieldRows.tsx` — `TextRow` 函数（当前位于 `FieldRows.tsx:183-255`）

- [ ] **Step 2.1：新建测试文件，先只覆盖 TextRow**

在 `web-next/src/components/settings/FieldRows.test.tsx` 写入完整内容：

```tsx
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

function makeMutation(overrides: Partial<FieldMutation> = {}): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
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
```

- [ ] **Step 2.2：跑测试，应该看到 TextRow 4 个用例里第 1 个失败**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

预期：

- `未覆盖且未改值时，按钮文案是"固化为租户值"且可点击` —— FAIL，原因是当前按钮文案是"已保存"且 `disabled`
- 其他 3 个用例：可能 PASS（已覆盖 / 未传 overrideMeta 行为本来就是 disabled）
- 但因为 React 18 + `useState(initial)` 不会随 prop 变更，整体 4 个用例里至少 1 个明确失败即可继续

如果命令找不到 `bun`，使用：

```powershell
npm --prefix web-next test -- --run src/components/settings/FieldRows.test.tsx
```

- [ ] **Step 2.3：修改 TextRow（FieldRows.tsx 第 183 行起的整个函数）**

把 `FieldRows.tsx` 中以下原函数：

```tsx
export function TextRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const initial = field.kind === 'json' ? isPrettyJson(value) : value;
  const [draft, setDraft] = useState(initial);
  const dirty = draft !== initial;
  const long = field.kind === 'longText' || field.kind === 'json';

  function save() {
    let payload = draft;
    if (field.kind === 'json') {
      try {
        payload = JSON.stringify(JSON.parse(draft));
      } catch {
        /* send as-is */
      }
    } else if (field.kind === 'number') {
      const n = Number(draft);
      if (!Number.isNaN(n)) payload = String(n);
    }
    update.mutate(
      { key: field.key, value: payload },
      {
        onSuccess: () => {
          onSaved(payload);
          toast.success(t('toast.save.success'));
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <div className='space-y-2 border-b border-line py-3 last:border-b-0'>
      <div className='flex items-center justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>{labelFor(field.label, i18n.language)}</Label>
            <OverrideBadge meta={overrideMeta} />
          </div>
          <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        </div>
        <div className='flex shrink-0 gap-1'>
          {dirty && (
            <Button type='button' variant='ghost' size='sm' onClick={() => setDraft(initial)}>
              {t('action.revert')}
            </Button>
          )}
          <ResetButton meta={overrideMeta} />
          <Button type='button' size='sm' disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? t('action.saving') : dirty ? t('action.save') : t('action.saved')}
          </Button>
        </div>
      </div>
      {long ? (
        <Textarea
          rows={field.kind === 'json' ? 8 : 4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={field.kind === 'json' ? 'font-mono text-12' : undefined}
        />
      ) : (
        <Input
          type={field.kind === 'number' ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {field.help && <p className='text-12 text-fg-2'>{labelFor(field.help, i18n.language)}</p>}
    </div>
  );
}
```

替换为：

```tsx
export function TextRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const initial = field.kind === 'json' ? isPrettyJson(value) : value;
  const [draft, setDraft] = useState(initial);
  const dirty = draft !== initial;
  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  const inForceMode = !dirty && canForceOverride;
  const long = field.kind === 'longText' || field.kind === 'json';

  function save() {
    let payload = draft;
    if (field.kind === 'json') {
      try {
        payload = JSON.stringify(JSON.parse(draft));
      } catch {
        /* send as-is */
      }
    } else if (field.kind === 'number') {
      const n = Number(draft);
      if (!Number.isNaN(n)) payload = String(n);
    }
    update.mutate(
      { key: field.key, value: payload },
      {
        onSuccess: () => {
          onSaved(payload);
          toast.success(t('toast.save.success'));
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  const saveLabel = update.isPending
    ? t('action.saving')
    : inForceMode
      ? t('action.force_override')
      : dirty
        ? t('action.save')
        : t('action.saved');

  return (
    <div className='space-y-2 border-b border-line py-3 last:border-b-0'>
      <div className='flex items-center justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>{labelFor(field.label, i18n.language)}</Label>
            <OverrideBadge meta={overrideMeta} />
          </div>
          <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        </div>
        <div className='flex shrink-0 gap-1'>
          {dirty && (
            <Button type='button' variant='ghost' size='sm' onClick={() => setDraft(initial)}>
              {t('action.revert')}
            </Button>
          )}
          <ResetButton meta={overrideMeta} />
          <Button
            type='button'
            size='sm'
            disabled={(!dirty && !canForceOverride) || update.isPending}
            onClick={save}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
      {long ? (
        <Textarea
          rows={field.kind === 'json' ? 8 : 4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={field.kind === 'json' ? 'font-mono text-12' : undefined}
        />
      ) : (
        <Input
          type={field.kind === 'number' ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {field.help && <p className='text-12 text-fg-2'>{labelFor(field.help, i18n.language)}</p>}
    </div>
  );
}
```

- [ ] **Step 2.4：再跑 TextRow 测试，4 个用例全部 PASS**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

预期所有 4 个 `describe('TextRow')` 用例都 PASS。

- [ ] **Step 2.5：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/FieldRows.tsx web-next/src/components/settings/FieldRows.test.tsx
git -C D:/top/keyapi commit -m "feat(settings/TextRow): allow lock-as-tenant-value when not overridden"
```

---

## Task 3：BoolRow 增加"固化"独立按钮（TDD）

**Files:**

- Modify: `web-next/src/components/settings/FieldRows.test.tsx` — 新增 describe('BoolRow')
- Modify: `web-next/src/components/settings/FieldRows.tsx` — `BoolRow` 函数（当前位于 `FieldRows.tsx:90-130`）

- [ ] **Step 3.1：在测试文件末尾追加 BoolRow 用例**

打开 `web-next/src/components/settings/FieldRows.test.tsx`，在文件末尾（`describe('TextRow', ...)` 之后）追加：

```tsx
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
```

- [ ] **Step 3.2：跑测试，3 个 BoolRow 用例第 1 个 FAIL**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

预期：`未覆盖时渲染"固化为租户值"按钮` FAIL（按钮不存在）。

- [ ] **Step 3.3：修改 BoolRow（FieldRows.tsx 第 90 行起的整个函数）**

把原函数：

```tsx
export function BoolRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const checked = coerceBool(value);
  return (
    <div className='flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-13'>{labelFor(field.label, i18n.language)}</span>
          <OverrideBadge meta={overrideMeta} />
        </div>
        <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        {field.help && (
          <p className='mt-1 max-w-3xl text-12 leading-5 text-fg-2'>
            {labelFor(field.help, i18n.language)}
          </p>
        )}
      </div>
      <div className='flex shrink-0 items-center gap-1'>
        <ResetButton meta={overrideMeta} />
        <Switch
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={(next) => {
            update.mutate(
              { key: field.key, value: next },
              {
                onSuccess: () => {
                  onSaved(String(next));
                  toast.success(t('toast.save.success'));
                },
                onError: (e) => toast.error((e as Error).message),
              }
            );
          }}
        />
      </div>
    </div>
  );
}
```

替换为：

```tsx
export function BoolRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const checked = coerceBool(value);
  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  return (
    <div className='flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-13'>{labelFor(field.label, i18n.language)}</span>
          <OverrideBadge meta={overrideMeta} />
        </div>
        <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        {field.help && (
          <p className='mt-1 max-w-3xl text-12 leading-5 text-fg-2'>
            {labelFor(field.help, i18n.language)}
          </p>
        )}
      </div>
      <div className='flex shrink-0 items-center gap-1'>
        {canForceOverride && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={update.isPending}
            onClick={() => {
              update.mutate(
                { key: field.key, value },
                {
                  onSuccess: () => {
                    onSaved(value);
                    toast.success(t('toast.save.success'));
                  },
                  onError: (e) => toast.error((e as Error).message),
                }
              );
            }}
          >
            {t('action.force_override')}
          </Button>
        )}
        <ResetButton meta={overrideMeta} />
        <Switch
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={(next) => {
            update.mutate(
              { key: field.key, value: next },
              {
                onSuccess: () => {
                  onSaved(String(next));
                  toast.success(t('toast.save.success'));
                },
                onError: (e) => toast.error((e as Error).message),
              }
            );
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3.4：再跑测试，BoolRow 3 个用例全部 PASS（且 TextRow 4 个用例继续 PASS）**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

- [ ] **Step 3.5：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/FieldRows.tsx web-next/src/components/settings/FieldRows.test.tsx
git -C D:/top/keyapi commit -m "feat(settings/BoolRow): add lock-as-tenant-value button when not overridden"
```

---

## Task 4：SelectRow 增加"固化"独立按钮（TDD）

**Files:**

- Modify: `web-next/src/components/settings/FieldRows.test.tsx` — 新增 describe('SelectRow')
- Modify: `web-next/src/components/settings/FieldRows.tsx` — `SelectRow` 函数（当前位于 `FieldRows.tsx:132-181`）

- [ ] **Step 4.1：在测试文件末尾追加 SelectRow 用例**

在 `FieldRows.test.tsx` 末尾追加：

```tsx
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
```

- [ ] **Step 4.2：跑测试，SelectRow 用例 1 应 FAIL**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

- [ ] **Step 4.3：修改 SelectRow（FieldRows.tsx 第 132 行起的整个函数）**

把原函数替换为：

```tsx
export function SelectRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const options = field.options ?? [];
  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  return (
    <div className='space-y-2 border-b border-line py-3 last:border-b-0'>
      <div className='flex items-center justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>{labelFor(field.label, i18n.language)}</Label>
            <OverrideBadge meta={overrideMeta} />
          </div>
          <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {canForceOverride && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={update.isPending}
              onClick={() => {
                update.mutate(
                  { key: field.key, value },
                  {
                    onSuccess: () => {
                      onSaved(value);
                      toast.success(t('toast.save.success'));
                    },
                    onError: (e) => toast.error((e as Error).message),
                  }
                );
              }}
            >
              {t('action.force_override')}
            </Button>
          )}
          <ResetButton meta={overrideMeta} />
          <Select
            value={value}
            disabled={update.isPending}
            onValueChange={(next) => {
              update.mutate(
                { key: field.key, value: next },
                {
                  onSuccess: () => {
                    onSaved(next);
                    toast.success(t('toast.save.success'));
                  },
                  onError: (e) => toast.error((e as Error).message),
                }
              );
            }}
          >
            <SelectTrigger className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {labelFor(o.label, i18n.language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {field.help && <p className='text-12 text-fg-2'>{labelFor(field.help, i18n.language)}</p>}
    </div>
  );
}
```

- [ ] **Step 4.4：再跑测试，SelectRow 3 个用例全部 PASS**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

- [ ] **Step 4.5：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/FieldRows.tsx web-next/src/components/settings/FieldRows.test.tsx
git -C D:/top/keyapi commit -m "feat(settings/SelectRow): add lock-as-tenant-value button when not overridden"
```

---

## Task 5：SecretRow 不变行为锁定测试（防回归）

**Files:**

- Modify: `web-next/src/components/settings/FieldRows.test.tsx` — 新增 describe('SecretRow')
- 不修改 `FieldRows.tsx` 中的 `SecretRow`

- [ ] **Step 5.1：在测试文件末尾追加 SecretRow 用例**

在 `FieldRows.test.tsx` 末尾追加：

```tsx
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
```

- [ ] **Step 5.2：跑测试，SecretRow 两个用例应直接 PASS（没改任何实现）**

```powershell
bun --cwd web-next test -- --run src/components/settings/FieldRows.test.tsx
```

预期：所有用例（TextRow / BoolRow / SelectRow / SecretRow）全部 PASS。

- [ ] **Step 5.3：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/FieldRows.test.tsx
git -C D:/top/keyapi commit -m "test(settings/SecretRow): pin no-force-override behavior"
```

---

## Task 6：KvMapEditor 支持"固化"（TDD）

**Files:**

- Create: `web-next/src/components/settings/KvMapEditor.test.tsx`
- Modify: `web-next/src/components/settings/KvMapEditor.tsx` — 保存按钮的 disabled / 文案

- [ ] **Step 6.1：新建 KvMapEditor 测试文件**

写入 `web-next/src/components/settings/KvMapEditor.test.tsx`：

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';
import type { FieldMutation } from './FieldRows';
import { KvMapEditor } from './KvMapEditor';
import type { FieldDef } from '@/lib/settingsSchema';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeMutation(): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
  return { mutate: vi.fn(), isPending: false } as FieldMutation & { mutate: ReturnType<typeof vi.fn> };
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
```

- [ ] **Step 6.2：跑测试，第 1 个 KvMapEditor 用例应 FAIL**

```powershell
bun --cwd web-next test -- --run src/components/settings/KvMapEditor.test.tsx
```

- [ ] **Step 6.3：修改 KvMapEditor.tsx**

在 `KvMapEditor.tsx`，找到 `const dirty = useMemo(...)` 这段（约 92-99 行）之后加：

```tsx
  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  const inForceMode = !dirty && canForceOverride;
```

然后把这段（约 177-179 行）：

```tsx
          <Button type='button' size='sm' disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? t('action.saving') : dirty ? t('action.save') : t('action.saved')}
          </Button>
```

替换为：

```tsx
          <Button
            type='button'
            size='sm'
            disabled={(!dirty && !canForceOverride) || update.isPending}
            onClick={save}
          >
            {update.isPending
              ? t('action.saving')
              : inForceMode
                ? t('action.force_override')
                : dirty
                  ? t('action.save')
                  : t('action.saved')}
          </Button>
```

- [ ] **Step 6.4：再跑测试，KvMapEditor 用例全部 PASS**

```powershell
bun --cwd web-next test -- --run src/components/settings/KvMapEditor.test.tsx
```

- [ ] **Step 6.5：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/KvMapEditor.tsx web-next/src/components/settings/KvMapEditor.test.tsx
git -C D:/top/keyapi commit -m "feat(settings/KvMapEditor): allow lock-as-tenant-value when not overridden"
```

---

## Task 7：StringListEditor 支持"固化"（TDD）

**Files:**

- Create: `web-next/src/components/settings/StringListEditor.test.tsx`
- Modify: `web-next/src/components/settings/StringListEditor.tsx` — 保存按钮的 disabled / 文案

- [ ] **Step 7.1：新建 StringListEditor 测试文件**

写入 `web-next/src/components/settings/StringListEditor.test.tsx`：

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import '@/i18n';
import type { FieldMutation } from './FieldRows';
import { StringListEditor } from './StringListEditor';
import type { FieldDef } from '@/lib/settingsSchema';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function makeMutation(): FieldMutation & { mutate: ReturnType<typeof vi.fn> } {
  return { mutate: vi.fn(), isPending: false } as FieldMutation & { mutate: ReturnType<typeof vi.fn> };
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
```

- [ ] **Step 7.2：跑测试，第 1 个 StringListEditor 用例应 FAIL**

```powershell
bun --cwd web-next test -- --run src/components/settings/StringListEditor.test.tsx
```

- [ ] **Step 7.3：修改 StringListEditor.tsx**

在 `StringListEditor.tsx`，找到 `const dirty = useMemo(...)` 那段（约 53-56 行）之后加：

```tsx
  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  const inForceMode = !dirty && canForceOverride;
```

然后把这段（约 130-132 行）：

```tsx
          <Button type='button' size='sm' disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? t('action.saving') : dirty ? t('action.save') : t('action.saved')}
          </Button>
```

替换为：

```tsx
          <Button
            type='button'
            size='sm'
            disabled={(!dirty && !canForceOverride) || update.isPending}
            onClick={save}
          >
            {update.isPending
              ? t('action.saving')
              : inForceMode
                ? t('action.force_override')
                : dirty
                  ? t('action.save')
                  : t('action.saved')}
          </Button>
```

- [ ] **Step 7.4：再跑测试，StringListEditor 用例全部 PASS**

```powershell
bun --cwd web-next test -- --run src/components/settings/StringListEditor.test.tsx
```

- [ ] **Step 7.5：commit**

```bash
git -C D:/top/keyapi add web-next/src/components/settings/StringListEditor.tsx web-next/src/components/settings/StringListEditor.test.tsx
git -C D:/top/keyapi commit -m "feat(settings/StringListEditor): allow lock-as-tenant-value when not overridden"
```

---

## Task 8：整体校验（lint / typecheck / 全套测试 + 手动验证）

**Files:** 无文件改动；仅校验。

- [ ] **Step 8.1：跑 web-next 全套测试**

```powershell
bun --cwd web-next test
```

预期：所有 settings 相关测试全部 PASS；其他既有测试不受影响。

如果失败：定位失败用例，回到对应任务排查；不要在本任务里硬改。

- [ ] **Step 8.2：跑 ESLint**

```powershell
bun --cwd web-next run lint
```

预期：无新增 error / warning（已存在的告警维持不变）。

- [ ] **Step 8.3：跑 TypeScript 类型检查（如果项目有独立 tsc 步骤）**

```powershell
bun --cwd web-next run build
```

或：

```powershell
npx --prefix web-next tsc --noEmit -p web-next/tsconfig.json
```

预期：无类型错误。

- [ ] **Step 8.4：手动验证（端到端复现这次的 bug 已被修）**

启动前后端，按下述步骤复现：

1. 平台后台先配好 SMTP（任意一组可用配置，比如 QQ 邮箱）
2. 切到某个**租户**的 `TenantConfig` 页面 → "SMTP 邮件" tab
3. 看到每个字段右侧标签为 **"平台默认"**
4. 不改任何字段，逐个点 **"固化为租户值"** 按钮（SMTPServer / SMTPPort / SMTPSSLEnabled / SMTPAccount / SMTPFrom；SMTPToken 仍然要手填）
5. 每点一个，刷新后该字段标签变 **"租户覆盖"**，"固化"按钮变成 **"已保存"** / 不再渲染（针对 Bool/Select）
6. 触发该租户的 注册验证码邮件 / 密码重置邮件 流程
7. 邮件应能正常发出，不再有 `invalid SMTP account` 或 `dial tcp :465: connect: connection refused`

- [ ] **Step 8.5：检查没漏掉 commit**

```bash
git -C D:/top/keyapi status
```

预期：工作区干净（除你本来就有的、跟本次无关的 modified/untracked 文件外）。

---

## 完成标准

- 全部 8 个 task 的所有步骤都打了勾
- 新增 3 个测试文件中所有 `test()` PASS
- 平台后台行为完全不变（`SettingsAdmin.tsx` 不传 `overrideMeta`，路径完全保持）
- 手动验证：租户后台原本卡死的 SMTP 配置能"固化"，并且租户能正常发件
- 全部改动以 6 次 commit 落库（i18n + 5 个组件改动；Task 5 是 test-only commit）
