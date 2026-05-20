import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateOption } from '@/hooks/useOptions';
import type { FieldDef } from '@/lib/settingsSchema';

export type FieldMutation = {
  mutate: (
    variables: { key: string; value: string | boolean | number },
    options?: {
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    }
  ) => void;
  isPending: boolean;
};

export type OverrideMeta = {
  isOverridden: boolean;
  onReset: () => void;
  resetPending?: boolean;
};

type RowProps = {
  field: FieldDef;
  value: string;
  onSaved: (next: string) => void;
  mutation?: FieldMutation;
  overrideMeta?: OverrideMeta;
};

function labelFor(label: { zh: string; en: string }, lang: string): string {
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

function OverrideBadge({ meta }: { meta?: OverrideMeta }) {
  const { t } = useTranslation('settings');
  if (!meta) return null;
  return (
    <Badge variant={meta.isOverridden ? 'default' : 'outline'} className='text-10'>
      {t(meta.isOverridden ? 'override.tenant' : 'override.platform')}
    </Badge>
  );
}

function ResetButton({ meta }: { meta?: OverrideMeta }) {
  const { t } = useTranslation('settings');
  if (!meta || !meta.isOverridden) return null;
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='text-danger'
      disabled={meta.resetPending}
      onClick={meta.onReset}
    >
      {t('action.reset')}
    </Button>
  );
}

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

export function SelectRow({ field, value, onSaved, mutation, overrideMeta }: RowProps) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const options = field.options ?? [];
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

export function SecretRow({
  field,
  mutation,
  overrideMeta,
}: {
  field: FieldDef;
  mutation?: FieldMutation;
  overrideMeta?: OverrideMeta;
}) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
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
        <div className='flex items-center gap-2'>
          <Label className='text-13'>{labelFor(field.label, i18n.language)}</Label>
          <OverrideBadge meta={overrideMeta} />
        </div>
        <div className='font-mono text-11 text-fg-2'>{field.key}</div>
        <Input
          type='password'
          placeholder={t('secrets.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <div className='flex shrink-0 gap-1'>
        <ResetButton meta={overrideMeta} />
        <Button type='button' size='sm' disabled={!draft || update.isPending} onClick={save}>
          {update.isPending ? t('action.saving') : t('action.save')}
        </Button>
      </div>
    </div>
  );
}

export { labelFor };
