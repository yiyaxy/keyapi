import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { BoolRow, labelFor, SecretRow, SelectRow, TextRow } from '@/components/settings/FieldRows';
import { KvMapEditor } from '@/components/settings/KvMapEditor';
import { ModelPricingPanel } from '@/components/settings/ModelPricingPanel';
import { MODEL_PRICING_KEYS } from '@/components/settings/modelPricingKeys';
import { StringListEditor } from '@/components/settings/StringListEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useForceLogoutAll,
  useOptions,
  useTestTicketStorageUpload,
  useUpdateTicketStorageSecret,
} from '@/hooks/useOptions';
import { allKnownKeys, SECRET_FIELDS, SETTINGS_GROUPS, type FieldDef } from '@/lib/settingsSchema';

type TabId = string;
const SECRETS_TAB = '__secrets';
const ADVANCED_TAB = '__advanced';
const TICKET_STORAGE_TAB = 'ticket_storage';

const TICKET_STORAGE_DEFAULTS: Record<string, string> = {
  'ticket_storage.allowed_mime_prefix': 'image/',
  'ticket_storage.force_path_style': 'false',
  'ticket_storage.max_file_size_mb': '5',
  'ticket_storage.max_files_per_ticket': '5',
  'ticket_storage.prefix': 'tickets/tmp',
  'ticket_storage.presign_expire_seconds': '900',
};

function FieldList({
  fields,
  values,
  onSaved,
  searchTerm,
  groupId,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onSaved: (key: string, next: string) => void;
  searchTerm: string;
  groupId: string;
}) {
  const { t } = useTranslation('settings');
  const isRatios = groupId === 'ratios';
  const isTicketStorage = groupId === TICKET_STORAGE_TAB;
  const filtered = useMemo(() => {
    const present = fields.filter((f) => {
      // In the ratios tab, per-model fields are owned by ModelPricingPanel
      if (isRatios && MODEL_PRICING_KEYS.includes(f.key as never)) return false;
      if (isTicketStorage) return true;
      return Object.prototype.hasOwnProperty.call(values, f.key);
    });
    if (!searchTerm) return present;
    const q = searchTerm.toLowerCase();
    return present.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.label.zh.toLowerCase().includes(q) ||
        f.label.en.toLowerCase().includes(q)
    );
  }, [fields, values, searchTerm, isRatios, isTicketStorage]);

  const showModelPanel =
    isRatios &&
    !searchTerm &&
    MODEL_PRICING_KEYS.some((k) => Object.prototype.hasOwnProperty.call(values, k));

  if (filtered.length === 0 && !showModelPanel) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
        {searchTerm ? t('empty.search') : t('empty.group')}
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      {showModelPanel && (
        <div className='rounded-md border border-line bg-bg-1 px-4'>
          <ModelPricingPanel values={values} onSaved={onSaved} />
        </div>
      )}
      {filtered.length > 0 && (
        <div className='rounded-md border border-line bg-bg-1 px-4'>
          {filtered.map((f) => {
            if (f.kind === 'bool') {
              return (
                <BoolRow
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? TICKET_STORAGE_DEFAULTS[f.key] ?? ''}
                  onSaved={(next) => onSaved(f.key, next)}
                />
              );
            }
            if (f.kind === 'select') {
              return (
                <SelectRow
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? TICKET_STORAGE_DEFAULTS[f.key] ?? ''}
                  onSaved={(next) => onSaved(f.key, next)}
                />
              );
            }
            if (f.kind === 'kvMap') {
              return (
                <KvMapEditor
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? TICKET_STORAGE_DEFAULTS[f.key] ?? ''}
                  onSaved={(next) => onSaved(f.key, next)}
                />
              );
            }
            if (f.kind === 'stringList') {
              return (
                <StringListEditor
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? TICKET_STORAGE_DEFAULTS[f.key] ?? ''}
                  onSaved={(next) => onSaved(f.key, next)}
                />
              );
            }
            return (
              <TextRow
                key={f.key}
                field={f}
                value={values[f.key] ?? TICKET_STORAGE_DEFAULTS[f.key] ?? ''}
                onSaved={(next) => onSaved(f.key, next)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdvancedList({
  unknown,
  onSaved,
  searchTerm,
}: {
  unknown: Array<{ key: string; value: string }>;
  onSaved: (key: string, next: string) => void;
  searchTerm: string;
}) {
  const { t } = useTranslation('settings');
  const filtered = useMemo(() => {
    if (!searchTerm) return unknown;
    const q = searchTerm.toLowerCase();
    return unknown.filter(
      (o) => o.key.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [unknown, searchTerm]);

  if (filtered.length === 0) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
        {searchTerm ? t('empty.search') : t('empty.group')}
      </div>
    );
  }

  return (
    <div className='rounded-md border border-line bg-bg-1 px-4'>
      {filtered.map((o) => {
        const isBool = o.value === 'true' || o.value === 'false';
        const field: FieldDef = {
          key: o.key,
          kind: isBool
            ? 'bool'
            : o.value.length > 80 || o.value.includes('\n')
              ? 'longText'
              : 'text',
          label: { zh: o.key, en: o.key },
        };
        return field.kind === 'bool' ? (
          <BoolRow
            key={o.key}
            field={field}
            value={o.value}
            onSaved={(next) => onSaved(o.key, next)}
          />
        ) : (
          <TextRow
            key={o.key}
            field={field}
            value={o.value}
            onSaved={(next) => onSaved(o.key, next)}
          />
        );
      })}
    </div>
  );
}

function TicketStorageSecretPanel() {
  const { t } = useTranslation('settings');
  const update = useUpdateTicketStorageSecret();
  const testUpload = useTestTicketStorageUpload();
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');

  function save() {
    if (!accessKey || !secretKey) return;
    update.mutate(
      { access_key: accessKey, secret_key: secretKey },
      {
        onSuccess: () => {
          setAccessKey('');
          setSecretKey('');
          toast.success(t('toast.save.success'));
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  function test() {
    testUpload.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`测试上传成功：${result.object_key}`);
      },
      onError: (e) => toast.error((e as Error).message),
    });
  }

  return (
    <div className='rounded-md border border-line bg-bg-1 px-4 py-3'>
      <div className='grid gap-3 md:grid-cols-2'>
        <div className='space-y-1'>
          <Label className='text-13'>AccessKey ID</Label>
          <Input
            type='password'
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder={t('secrets.placeholder')}
          />
        </div>
        <div className='space-y-1'>
          <Label className='text-13'>AccessKey Secret</Label>
          <Input
            type='password'
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={t('secrets.placeholder')}
          />
        </div>
      </div>
      <div className='mt-3 flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={testUpload.isPending}
          onClick={test}
        >
          {testUpload.isPending ? '正在测试' : '测试上传'}
        </Button>
        <Button
          type='button'
          size='sm'
          disabled={!accessKey || !secretKey || update.isPending}
          onClick={save}
        >
          {update.isPending ? t('action.saving') : t('action.save')}
        </Button>
      </div>
    </div>
  );
}

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

export function SettingsAdminPage() {
  const { t, i18n } = useTranslation('settings');
  const list = useOptions();
  const forceLogout = useForceLogoutAll();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false);

  const activeTab: TabId = searchParams.get('tab') ?? SETTINGS_GROUPS[0]!.id;
  function setActiveTab(id: TabId) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  }

  const known = useMemo(() => allKnownKeys(), []);

  const values: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of list.data ?? []) m[o.key] = o.value;
    return { ...m, ...overrides };
  }, [list.data, overrides]);

  const unknown = useMemo(
    () => (list.data ?? []).filter((o) => !known.has(o.key)),
    [list.data, known]
  );

  const groupCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of SETTINGS_GROUPS) {
      m[g.id] = g.fields.filter((f) => Object.prototype.hasOwnProperty.call(values, f.key)).length;
    }
    return m;
  }, [values]);

  function onSaved(key: string, next: string) {
    setOverrides((prev) => ({ ...prev, [key]: next }));
  }

  const activeGroup = SETTINGS_GROUPS.find((g) => g.id === activeTab);
  const activeTitle =
    activeTab === SECRETS_TAB
      ? t('secrets.title')
      : activeTab === ADVANCED_TAB
        ? t('advanced.title')
        : activeGroup
          ? labelFor(activeGroup.title, i18n.language)
          : '';
  const activeSub =
    activeTab === SECRETS_TAB
      ? t('secrets.sub')
      : activeTab === ADVANCED_TAB
        ? t('advanced.sub')
        : '';

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className='ml-auto'>
          <Button
            type='button'
            variant='secondary'
            className='text-danger'
            onClick={() => setForceLogoutOpen(true)}
          >
            {t('action.force_logout')}
          </Button>
        </div>
      </div>
      {list.isError && (
        <InlineBanner
          level='danger'
          message={String((list.error as Error).message)}
          onClose={() => void list.refetch()}
        />
      )}
      {list.isPending ? (
        <div className='space-y-3'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-20 w-full' />
          ))}
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-[220px_1fr]'>
          <aside className='space-y-1 rounded-md border border-line bg-bg-0 p-2'>
            {SETTINGS_GROUPS.map((g) => (
              <TabLink
                key={g.id}
                active={activeTab === g.id}
                onClick={() => setActiveTab(g.id)}
                count={groupCounts[g.id] ?? 0}
              >
                {labelFor(g.title, i18n.language)}
              </TabLink>
            ))}
            <div className='my-2 border-t border-line' />
            <TabLink
              active={activeTab === SECRETS_TAB}
              onClick={() => setActiveTab(SECRETS_TAB)}
              count={SECRET_FIELDS.length}
            >
              {t('secrets.title')}
            </TabLink>
            <TabLink
              active={activeTab === ADVANCED_TAB}
              onClick={() => setActiveTab(ADVANCED_TAB)}
              count={unknown.length}
            >
              {t('advanced.title')}
            </TabLink>
          </aside>
          <div className='min-w-0 space-y-3'>
            <div>
              <h2 className='text-16 font-semibold'>{activeTitle}</h2>
              {activeSub && <p className='text-12 text-fg-2'>{activeSub}</p>}
            </div>
            {activeTab === SECRETS_TAB ? (
              <div className='rounded-md border border-line bg-bg-1 px-4'>
                {SECRET_FIELDS.map((f) => (
                  <SecretRow key={f.key} field={f} />
                ))}
              </div>
            ) : activeTab === ADVANCED_TAB ? (
              <AdvancedList unknown={unknown} onSaved={onSaved} searchTerm={keyword} />
            ) : activeGroup ? (
              <div className='space-y-3'>
                <FieldList
                  groupId={activeGroup.id}
                  fields={activeGroup.fields}
                  values={values}
                  onSaved={onSaved}
                  searchTerm={keyword}
                />
                {activeGroup.id === TICKET_STORAGE_TAB && !keyword && <TicketStorageSecretPanel />}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={forceLogoutOpen}
        title={t('force_logout.title')}
        body={t('force_logout.body')}
        confirmLabel={t('force_logout.confirm')}
        isPending={forceLogout.isPending}
        onOpenChange={setForceLogoutOpen}
        onConfirm={() => {
          setForceLogoutOpen(false);
          forceLogout.mutate(undefined, {
            onSuccess: () => toast.success(t('toast.force_logout.success')),
            onError: (e) => toast.error((e as Error).message),
          });
        }}
      />
    </div>
  );
}
