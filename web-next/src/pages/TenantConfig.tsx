import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import {
  BoolRow,
  type FieldMutation,
  labelFor,
  type OverrideMeta,
  SecretRow,
  SelectRow,
  TextRow,
} from '@/components/settings/FieldRows';
import { KvMapEditor } from '@/components/settings/KvMapEditor';
import { StringListEditor } from '@/components/settings/StringListEditor';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteTenantConfig,
  useSetTenantConfig,
  useTenantConfig,
} from '@/hooks/useTenantConfig';
import { SETTINGS_GROUPS, type FieldDef, type Group } from '@/lib/settingsSchema';

type TabId = string;

// 租户专属字段：白名单里存在但平台 SETTINGS_GROUPS 没收录的，单独成组
const TENANT_EXTRA_GROUP: Group = {
  id: 'tenant_notify',
  title: { zh: '通知与告警', en: 'Notifications' },
  fields: [
    {
      key: 'WebhookURL',
      kind: 'text',
      label: { zh: '告警 Webhook URL', en: 'Alert webhook URL' },
      help: {
        zh: '租户级告警将向此 URL 发送 POST 通知',
        en: 'Tenant-level alerts POST to this URL',
      },
    },
    {
      key: 'WebhookSecret',
      kind: 'secret',
      label: { zh: 'Webhook 签名密钥', en: 'Webhook signing secret' },
      help: {
        zh: '用于 HMAC 签名 webhook payload',
        en: 'HMAC secret for signing webhook payloads',
      },
    },
  ],
};

const ALL_GROUPS: Group[] = [...SETTINGS_GROUPS, TENANT_EXTRA_GROUP];

function TabLink({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-13 ${
        active ? 'bg-bg-1 text-fg-0' : 'text-fg-1 hover:bg-bg-1'
      }`}
    >
      <span className='truncate'>{children}</span>
      <span className='shrink-0 text-11 text-fg-2'>{count}</span>
    </button>
  );
}

function FieldList({
  fields,
  values,
  overridden,
  searchTerm,
  mutation,
  onResetKey,
  resetPendingKey,
  onSavedLocal,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  overridden: Set<string>;
  searchTerm: string;
  mutation: FieldMutation;
  onResetKey: (key: string) => void;
  resetPendingKey: string | null;
  onSavedLocal: (key: string, next: string) => void;
}) {
  const { t } = useTranslation('settings');
  const filtered = useMemo(() => {
    if (!searchTerm) return fields;
    const q = searchTerm.toLowerCase();
    return fields.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.label.zh.toLowerCase().includes(q) ||
        f.label.en.toLowerCase().includes(q)
    );
  }, [fields, searchTerm]);

  if (filtered.length === 0) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
        {searchTerm ? t('empty.search') : t('empty.group')}
      </div>
    );
  }

  return (
    <div className='rounded-md border border-line bg-bg-1 px-4'>
      {filtered.map((f) => {
        const meta: OverrideMeta = {
          isOverridden: overridden.has(f.key),
          onReset: () => onResetKey(f.key),
          resetPending: resetPendingKey === f.key,
        };
        const value = values[f.key] ?? '';
        const onSaved = (next: string) => onSavedLocal(f.key, next);
        if (f.kind === 'bool') {
          return (
            <BoolRow
              key={f.key}
              field={f}
              value={value}
              onSaved={onSaved}
              mutation={mutation}
              overrideMeta={meta}
            />
          );
        }
        if (f.kind === 'select') {
          return (
            <SelectRow
              key={f.key}
              field={f}
              value={value}
              onSaved={onSaved}
              mutation={mutation}
              overrideMeta={meta}
            />
          );
        }
        if (f.kind === 'kvMap') {
          return (
            <KvMapEditor
              key={f.key}
              field={f}
              value={value}
              onSaved={onSaved}
              mutation={mutation}
              overrideMeta={meta}
            />
          );
        }
        if (f.kind === 'stringList') {
          return (
            <StringListEditor
              key={f.key}
              field={f}
              value={value}
              onSaved={onSaved}
              mutation={mutation}
              overrideMeta={meta}
            />
          );
        }
        if (f.kind === 'secret') {
          return <SecretRow key={f.key} field={f} mutation={mutation} overrideMeta={meta} />;
        }
        return (
          <TextRow
            key={f.key}
            field={f}
            value={value}
            onSaved={onSaved}
            mutation={mutation}
            overrideMeta={meta}
          />
        );
      })}
    </div>
  );
}

export function TenantConfigPage() {
  const { t, i18n } = useTranslation('tenant');
  const tSettings = useTranslation('settings').t;
  const config = useTenantConfig();
  const setOverride = useSetTenantConfig();
  const deleteOverride = useDeleteTenantConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [pendingResetKey, setPendingResetKey] = useState<string | null>(null);

  const items = config.data ?? [];

  // 后端按白名单返回 items；这就是当前租户能见的全部 key
  const allowed = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  const values: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) m[it.key] = it.value;
    return { ...m, ...overrides };
  }, [items, overrides]);

  const overriddenSet = useMemo(
    () => new Set(items.filter((i) => i.overridden).map((i) => i.key)),
    [items]
  );

  // 按 group 过滤：只保留白名单内的字段
  const visibleGroups = useMemo(() => {
    return ALL_GROUPS.map((g) => ({
      group: g,
      fields: g.fields.filter((f) => allowed.has(f.key)),
    })).filter((g) => g.fields.length > 0);
  }, [allowed]);

  const firstGroupId = visibleGroups[0]?.group.id ?? '';
  const activeTab: TabId = searchParams.get('tab') ?? firstGroupId;

  function setActiveTab(id: TabId) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  }

  const activeGroup = visibleGroups.find((g) => g.group.id === activeTab);
  const activeTitle = activeGroup ? labelFor(activeGroup.group.title, i18n.language) : '';

  // 适配 FieldMutation：useSetTenantConfig 接口已匹配（mutate {key,value}, isPending）
  const mutation: FieldMutation = useMemo(
    () => ({
      mutate: (vars, opts) =>
        setOverride.mutate(
          { key: vars.key, value: String(vars.value) },
          {
            onSuccess: () => opts?.onSuccess?.(),
            onError: (e) => opts?.onError?.(e),
          }
        ),
      isPending: setOverride.isPending,
    }),
    [setOverride]
  );

  function onResetKey(key: string) {
    setPendingResetKey(key);
    deleteOverride.mutate(key, {
      onSuccess: () => {
        setPendingResetKey(null);
        // 清掉本地 override 缓存以便从服务端重读
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toast.success(t('config.reset.success'));
      },
      onError: (e) => {
        setPendingResetKey(null);
        toast.error((e as Error).message);
      },
    });
  }

  function onSavedLocal(key: string, next: string) {
    setOverrides((prev) => ({ ...prev, [key]: next }));
  }

  return (
    <div className='space-y-4'>
      <header>
        <h1 className='text-20 font-semibold'>{t('config.title')}</h1>
        <p className='mt-1 text-13 text-fg-2'>{t('config.sub')}</p>
      </header>

      {config.isError && (
        <InlineBanner
          level='danger'
          message={String((config.error as Error).message)}
          onClose={() => void config.refetch()}
        />
      )}

      {config.isPending ? (
        <div className='space-y-3'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-20 w-full' />
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('config.empty')}
        </div>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              className='max-w-xs'
              placeholder={tSettings('search.placeholder')}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className='grid gap-4 md:grid-cols-[220px_1fr]'>
            <aside className='space-y-1 rounded-md border border-line bg-bg-0 p-2'>
              {visibleGroups.map((g) => (
                <TabLink
                  key={g.group.id}
                  active={activeTab === g.group.id}
                  onClick={() => setActiveTab(g.group.id)}
                  count={g.fields.length}
                >
                  {labelFor(g.group.title, i18n.language)}
                </TabLink>
              ))}
            </aside>
            <div className='min-w-0 space-y-3'>
              <div>
                <h2 className='text-16 font-semibold'>{activeTitle}</h2>
              </div>
              {activeGroup ? (
                <FieldList
                  fields={activeGroup.fields}
                  values={values}
                  overridden={overriddenSet}
                  searchTerm={keyword}
                  mutation={mutation}
                  onResetKey={onResetKey}
                  resetPendingKey={pendingResetKey}
                  onSavedLocal={onSavedLocal}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
