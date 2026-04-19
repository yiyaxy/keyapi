import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useForceLogoutAll,
  useOptions,
  useUpdateOption,
} from '@/hooks/useOptions';
import {
  allKnownKeys,
  SECRET_FIELDS,
  SETTINGS_GROUPS,
  type FieldDef,
  type Group,
} from '@/lib/settingsSchema';

function labelFor(
  label: { zh: string; en: string },
  lang: string
): string {
  return lang.startsWith('zh') ? label.zh : label.en;
}

function coerceBool(v: string): boolean {
  return v === 'true' || v === '1';
}

function isPrettyJson(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function BoolRow({
  field,
  value,
  onSaved,
}: {
  field: FieldDef;
  value: string;
  onSaved: (next: string) => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const update = useUpdateOption();
  const checked = coerceBool(value);
  return (
    <div className='flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0'>
      <div className='min-w-0'>
        <div className='text-13'>{labelFor(field.label, i18n.language)}</div>
        <div className='font-mono text-11 text-fg-2'>{field.key}</div>
      </div>
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
  );
}

function TextRow({
  field,
  value,
  onSaved,
}: {
  field: FieldDef;
  value: string;
  onSaved: (next: string) => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const update = useUpdateOption();
  const initial =
    field.kind === 'json' ? isPrettyJson(value) : value;
  const [draft, setDraft] = useState(initial);
  const dirty = draft !== initial;

  const long = field.kind === 'longText' || field.kind === 'json';

  function save() {
    // Normalise JSON on save so backend stores compact form when valid
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
        <div className='min-w-0'>
          <Label className='text-13'>
            {labelFor(field.label, i18n.language)}
          </Label>
          <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        </div>
        <div className='flex shrink-0 gap-1'>
          {dirty && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setDraft(initial)}
            >
              {t('action.revert')}
            </Button>
          )}
          <Button
            type='button'
            size='sm'
            disabled={!dirty || update.isPending}
            onClick={save}
          >
            {update.isPending
              ? t('action.saving')
              : dirty
                ? t('action.save')
                : t('action.saved')}
          </Button>
        </div>
      </div>
      {long ? (
        <Textarea
          rows={field.kind === 'json' ? 8 : 4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={
            field.kind === 'json' ? 'font-mono text-12' : undefined
          }
        />
      ) : (
        <Input
          type={field.kind === 'number' ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    </div>
  );
}

function SecretRow({ field }: { field: FieldDef }) {
  const { t, i18n } = useTranslation('settings');
  const update = useUpdateOption();
  const [draft, setDraft] = useState('');

  function save() {
    if (!draft) return;
    update.mutate(
      { key: field.key, value: draft },
      {
        onSuccess: () => {
          setDraft('');
          toast.success(t('toast.save.success'));
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <div className='flex items-end justify-between gap-4 border-b border-line py-3 last:border-b-0'>
      <div className='min-w-0 flex-1 space-y-1'>
        <Label className='text-13'>
          {labelFor(field.label, i18n.language)}
        </Label>
        <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        <Input
          type='password'
          placeholder={t('secrets.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <Button
        type='button'
        size='sm'
        disabled={!draft || update.isPending}
        onClick={save}
      >
        {update.isPending ? t('action.saving') : t('action.save')}
      </Button>
    </div>
  );
}

function GroupCard({
  group,
  values,
  onSaved,
  searchTerm,
}: {
  group: Group;
  values: Record<string, string>;
  onSaved: (key: string, next: string) => void;
  searchTerm: string;
}) {
  const { t, i18n } = useTranslation('settings');
  const [open, setOpen] = useState(true);

  const fields = useMemo(() => {
    const present = group.fields.filter((f) =>
      Object.prototype.hasOwnProperty.call(values, f.key)
    );
    if (!searchTerm) return present;
    const q = searchTerm.toLowerCase();
    return present.filter((f) => {
      if (f.key.toLowerCase().includes(q)) return true;
      const zh = f.label.zh.toLowerCase();
      const en = f.label.en.toLowerCase();
      return zh.includes(q) || en.includes(q);
    });
  }, [group.fields, values, searchTerm]);

  if (fields.length === 0) return null;

  return (
    <section className='rounded-md border border-line bg-bg-1'>
      <button
        type='button'
        className='flex w-full items-center justify-between gap-2 px-4 py-3 text-left'
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className='text-14 font-medium'>
          {labelFor(group.title, i18n.language)}
        </h3>
        <span className='text-12 text-fg-2'>
          {fields.length} · {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className='divide-y divide-line border-t border-line px-4 py-1'>
          {fields.map((f) =>
            f.kind === 'bool' ? (
              <BoolRow
                key={f.key}
                field={f}
                value={values[f.key]!}
                onSaved={(next) => onSaved(f.key, next)}
              />
            ) : (
              <TextRow
                key={f.key}
                field={f}
                value={values[f.key]!}
                onSaved={(next) => onSaved(f.key, next)}
              />
            )
          )}
        </div>
      )}
      {fields.length === 0 && (
        <div className='px-4 py-6 text-13 text-fg-2'>{t('empty.group')}</div>
      )}
    </section>
  );
}

function SecretsCard() {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);

  return (
    <section className='rounded-md border border-line bg-bg-1'>
      <button
        type='button'
        className='flex w-full items-center justify-between gap-2 px-4 py-3 text-left'
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <h3 className='text-14 font-medium'>{t('secrets.title')}</h3>
          <p className='text-12 text-fg-2'>{t('secrets.sub')}</p>
        </div>
        <span className='text-12 text-fg-2'>
          {SECRET_FIELDS.length} · {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className='divide-y divide-line border-t border-line px-4 py-1'>
          {SECRET_FIELDS.map((f) => (
            <SecretRow key={f.key} field={f} />
          ))}
        </div>
      )}
    </section>
  );
}

function AdvancedCard({
  unknown,
  onSaved,
  searchTerm,
}: {
  unknown: Array<{ key: string; value: string }>;
  onSaved: (key: string, next: string) => void;
  searchTerm: string;
}) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!searchTerm) return unknown;
    const q = searchTerm.toLowerCase();
    return unknown.filter(
      (o) =>
        o.key.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q)
    );
  }, [unknown, searchTerm]);

  if (unknown.length === 0) return null;

  return (
    <section className='rounded-md border border-line bg-bg-1'>
      <button
        type='button'
        className='flex w-full items-center justify-between gap-2 px-4 py-3 text-left'
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <h3 className='text-14 font-medium'>{t('advanced.title')}</h3>
          <p className='text-12 text-fg-2'>{t('advanced.sub')}</p>
        </div>
        <span className='text-12 text-fg-2'>
          {filtered.length} · {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className='divide-y divide-line border-t border-line px-4 py-1'>
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
      )}
    </section>
  );
}

export function SettingsAdminPage() {
  const { t } = useTranslation('settings');
  const list = useOptions();
  const forceLogout = useForceLogoutAll();
  const [keyword, setKeyword] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false);

  const known = useMemo(() => allKnownKeys(), []);

  const values: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of list.data ?? []) m[o.key] = o.value;
    return { ...m, ...overrides };
  }, [list.data, overrides]);

  const unknown = useMemo(() => {
    return (list.data ?? []).filter((o) => !known.has(o.key));
  }, [list.data, known]);

  function onSaved(key: string, next: string) {
    setOverrides((prev) => ({ ...prev, [key]: next }));
  }

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
        <div className='space-y-3'>
          {SETTINGS_GROUPS.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              values={values}
              onSaved={onSaved}
              searchTerm={keyword}
            />
          ))}
          <SecretsCard />
          <AdvancedCard unknown={unknown} onSaved={onSaved} searchTerm={keyword} />
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
