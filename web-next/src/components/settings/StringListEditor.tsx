import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FieldMutation, OverrideMeta } from '@/components/settings/FieldRows';
import { useUpdateOption } from '@/hooks/useOptions';
import type { FieldDef } from '@/lib/settingsSchema';

function parseList(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* fallthrough */
  }
  return [];
}

export function StringListEditor({
  field,
  value,
  onSaved,
  mutation,
  overrideMeta,
}: {
  field: FieldDef;
  value: string;
  onSaved: (next: string) => void;
  mutation?: FieldMutation;
  overrideMeta?: OverrideMeta;
}) {
  const { t, i18n } = useTranslation('settings');
  const fallback = useUpdateOption();
  const update = mutation ?? fallback;
  const initial = useMemo(() => parseList(value), [value]);
  const [items, setItems] = useState<string[]>(initial);
  const [input, setInput] = useState('');

  const lang = i18n.language;
  const label = lang.startsWith('zh') ? field.label.zh : field.label.en;
  const help = field.help ? (lang.startsWith('zh') ? field.help.zh : field.help.en) : '';

  const dirty = useMemo(() => {
    if (items.length !== initial.length) return true;
    return items.some((v, i) => v !== initial[i]);
  }, [items, initial]);

  function add() {
    const v = input.trim();
    if (!v) return;
    if (items.includes(v)) return;
    setItems((prev) => [...prev, v]);
    setInput('');
  }

  function move(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    const json = JSON.stringify(items);
    update.mutate(
      { key: field.key, value: json },
      {
        onSuccess: () => {
          onSaved(json);
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
            <Label className='text-13'>{label}</Label>
            {overrideMeta && (
              <Badge
                variant={overrideMeta.isOverridden ? 'default' : 'outline'}
                className='text-10'
              >
                {t(overrideMeta.isOverridden ? 'override.tenant' : 'override.platform')}
              </Badge>
            )}
          </div>
          <div className='font-mono text-11 text-fg-2'>{field.key}</div>
          {help && <div className='mt-1 text-12 text-fg-2'>{help}</div>}
        </div>
        <div className='flex shrink-0 gap-1'>
          {dirty && (
            <Button type='button' variant='ghost' size='sm' onClick={() => setItems(initial)}>
              {t('action.revert')}
            </Button>
          )}
          {overrideMeta?.isOverridden && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='text-danger'
              disabled={overrideMeta.resetPending}
              onClick={overrideMeta.onReset}
            >
              {t('action.reset')}
            </Button>
          )}
          <Button type='button' size='sm' disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? t('action.saving') : dirty ? t('action.save') : t('action.saved')}
          </Button>
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <Input
          value={input}
          placeholder={t('list.add_placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className='max-w-xs'
        />
        <Button type='button' variant='secondary' size='sm' onClick={add}>
          {t('kv.add')}
        </Button>
      </div>
      {items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-0 p-4 text-center text-12 text-fg-2'>
          {t('list.empty')}
        </div>
      ) : (
        <ul className='space-y-1'>
          {items.map((v, i) => (
            <li
              key={`${v}-${i}`}
              className='flex items-center gap-2 rounded-md border border-line bg-bg-0 px-3 py-1.5'
            >
              <span className='w-6 text-11 text-fg-2'>{i + 1}</span>
              <span className='flex-1 font-mono text-12'>{v}</span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='text-danger'
                onClick={() => remove(i)}
              >
                {t('kv.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
