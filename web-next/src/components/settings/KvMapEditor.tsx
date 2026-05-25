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

type Row = { id: string; k: string; v: string };

function parseMap(value: string): Record<string, string | number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number>;
    }
  } catch {
    /* fallthrough */
  }
  return {};
}

function toRows(map: Record<string, string | number>): Row[] {
  return Object.entries(map).map(([k, v], i) => ({
    id: `${i}-${k}`,
    k,
    v: String(v),
  }));
}

function rowsToJson(rows: Row[], valueType: 'number' | 'string'): string {
  const obj: Record<string, number | string> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (!k) continue;
    if (valueType === 'number') {
      const n = Number(r.v);
      if (Number.isNaN(n)) continue;
      obj[k] = n;
    } else {
      obj[k] = r.v;
    }
  }
  return JSON.stringify(obj);
}

let rowSeq = 0;
function newRow(): Row {
  rowSeq += 1;
  return { id: `new-${rowSeq}`, k: '', v: '' };
}

export function KvMapEditor({
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
  const [filter, setFilter] = useState('');

  const initialRows = useMemo(() => toRows(parseMap(value)), [value]);
  const [rows, setRows] = useState<Row[]>(initialRows);

  const valueType = field.kvValueType ?? 'string';
  const lang = i18n.language;
  const keyLabel = field.kvKeyLabel
    ? lang.startsWith('zh')
      ? field.kvKeyLabel.zh
      : field.kvKeyLabel.en
    : 'Key';
  const valueLabel = field.kvValueLabel
    ? lang.startsWith('zh')
      ? field.kvValueLabel.zh
      : field.kvValueLabel.en
    : 'Value';

  const dirty = useMemo(() => {
    if (rows.length !== initialRows.length) return true;
    const aMap = new Map(initialRows.map((r) => [r.k, r.v]));
    for (const r of rows) {
      if (aMap.get(r.k) !== r.v) return true;
    }
    return false;
  }, [rows, initialRows]);

  const canForceOverride = !!overrideMeta && !overrideMeta.isOverridden;
  const inForceMode = !dirty && canForceOverride;

  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) => r.k.toLowerCase().includes(q) || r.v.toLowerCase().includes(q));
  }, [rows, filter]);

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow() {
    setRows((prev) => [newRow(), ...prev]);
  }

  function save() {
    const json = rowsToJson(rows, valueType);
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

  function revert() {
    setRows(initialRows);
  }

  const help = field.help ? (lang.startsWith('zh') ? field.help.zh : field.help.en) : '';

  return (
    <div className='space-y-2 border-b border-line py-3 last:border-b-0'>
      <div className='flex items-center justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>
              {lang.startsWith('zh') ? field.label.zh : field.label.en}
            </Label>
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
            <Button type='button' variant='ghost' size='sm' onClick={revert}>
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
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('kv.search')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button type='button' variant='secondary' size='sm' onClick={addRow}>
          {t('kv.add')}
        </Button>
        <span className='ml-auto text-11 text-fg-2'>
          {rows.length} {t('kv.rows')}
        </span>
      </div>
      {filteredRows.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-0 p-4 text-center text-12 text-fg-2'>
          {filter ? t('kv.empty_search') : t('kv.empty')}
        </div>
      ) : (
        <div className='max-h-[420px] overflow-y-auto rounded-md border border-line'>
          <table className='w-full border-collapse'>
            <thead className='sticky top-0 bg-bg-1'>
              <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
                <th className='px-2 py-2 font-medium'>{keyLabel}</th>
                <th className='px-2 py-2 font-medium'>{valueLabel}</th>
                <th className='px-2 py-2' />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className='border-b border-line last:border-b-0'>
                  <td className='w-1/2 px-2 py-1'>
                    <Input
                      value={r.k}
                      onChange={(e) => updateRow(r.id, { k: e.target.value })}
                      className='h-8 font-mono text-12'
                    />
                  </td>
                  <td className='w-1/2 px-2 py-1'>
                    <Input
                      type={valueType === 'number' ? 'number' : 'text'}
                      step='any'
                      value={r.v}
                      onChange={(e) => updateRow(r.id, { v: e.target.value })}
                      className='h-8 tabular-nums'
                    />
                  </td>
                  <td className='px-2 py-1 text-right'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-danger'
                      onClick={() => deleteRow(r.id)}
                    >
                      {t('kv.delete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
