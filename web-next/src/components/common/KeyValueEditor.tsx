import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// KeyValueEditor is a structured alternative to a JSON textarea for
// string→string maps (model_mapping, header_override, status_code_mapping).
// Consumers pass the JSON-serialized value in and get a JSON string back —
// drop-in replacement wherever we'd otherwise bind a <Textarea> to the
// form.
//
// Why a string-in/string-out contract: the existing form state keeps
// model_mapping/etc. as JSON strings so react-hook-form's zod schema
// (which validates JSON parseability) stays untouched.

type Row = { id: number; key: string; value: string };

function parseValue(raw: string): Row[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).map(([k, v], idx) => ({
      id: idx,
      key: k,
      // Non-string values (rare here, but defensive) become their JSON form
      // so round-tripping doesn't silently drop data on a user that
      // pasted param-override-flavoured JSON into the wrong field.
      value: typeof v === 'string' ? v : JSON.stringify(v),
    }));
  } catch {
    return [];
  }
}

function serializeRows(rows: Row[]): string {
  const obj: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    obj[k] = r.value;
  }
  if (Object.keys(obj).length === 0) return '';
  return JSON.stringify(obj);
}

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('channels');
  const [rows, setRows] = useState<Row[]>(() => parseValue(value));
  const [nextId, setNextId] = useState(() => rows.length);

  // Keep local rows in sync when the outer value changes (e.g. edit dialog
  // re-opens on a different channel). Skip when the re-serialized form of
  // our own rows equals `value` — that's our own edit bouncing back.
  useEffect(() => {
    if (serializeRows(rows) === value) return;
    const fresh = parseValue(value);
    setRows(fresh);
    setNextId(fresh.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(next: Row[]) {
    setRows(next);
    onChange(serializeRows(next));
  }

  function updateRow(id: number, patch: Partial<Row>) {
    emit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: number) {
    emit(rows.filter((r) => r.id !== id));
  }

  function addRow() {
    const row: Row = { id: nextId, key: '', value: '' };
    setNextId(nextId + 1);
    emit([...rows, row]);
  }

  return (
    <div className='space-y-2'>
      {rows.length > 0 && (
        <div className='space-y-1.5'>
          {rows.map((r) => (
            <div key={r.id} className='flex items-center gap-2'>
              <Input
                value={r.key}
                placeholder={keyPlaceholder}
                onChange={(e) => updateRow(r.id, { key: e.target.value })}
                disabled={disabled}
                className='font-mono text-12'
              />
              <span className='text-fg-2'>→</span>
              <Input
                value={r.value}
                placeholder={valuePlaceholder}
                onChange={(e) => updateRow(r.id, { value: e.target.value })}
                disabled={disabled}
                className='font-mono text-12'
              />
              <button
                type='button'
                onClick={() => removeRow(r.id)}
                disabled={disabled}
                aria-label='remove'
                className='shrink-0 rounded-sm p-1 text-fg-2 hover:bg-bg-2 hover:text-danger'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button
        type='button'
        variant='secondary'
        size='sm'
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className='mr-1 h-3.5 w-3.5' />
        {t('form.kv.add_row')}
      </Button>
    </div>
  );
}
