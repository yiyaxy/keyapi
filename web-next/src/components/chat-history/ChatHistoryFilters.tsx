import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ChatHistoryFilterValues = {
  user_id: number;
  model: string;
  /** Unix seconds; 0 = unset */
  from: number;
  /** Unix seconds; 0 = unset */
  to: number;
  /** Platform admin only — ignored server-side for tenant admins. 0 = all. */
  tenant_id: number;
};

type Props = {
  value: ChatHistoryFilterValues;
  onChange: (next: ChatHistoryFilterValues) => void;
};

export function ChatHistoryFilters({ value, onChange }: Props) {
  // Local state so user can edit several fields and submit with one click,
  // matching the pattern used by LogsAdminFilters elsewhere in the project.
  const [draft, setDraft] = useState<DraftValues>(toDraft(value));

  return (
    <form
      className='flex flex-wrap items-end gap-3 rounded-md border border-line bg-bg-1 p-3'
      onSubmit={(e) => {
        e.preventDefault();
        onChange(fromDraft(draft));
      }}
    >
      <Field label='User ID'>
        <Input
          type='number'
          inputMode='numeric'
          value={draft.user_id}
          onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}
          className='w-28'
        />
      </Field>
      <Field label='模型'>
        <Input
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          className='w-44'
          placeholder='gpt-5.5'
        />
      </Field>
      <Field label='起始时间'>
        <Input
          type='datetime-local'
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
      </Field>
      <Field label='结束时间'>
        <Input
          type='datetime-local'
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
      </Field>
      <Field label='Tenant ID（仅超管）'>
        <Input
          type='number'
          inputMode='numeric'
          value={draft.tenant_id}
          onChange={(e) => setDraft({ ...draft, tenant_id: e.target.value })}
          className='w-28'
        />
      </Field>
      <div className='flex gap-2'>
        <Button type='submit' size='sm'>
          应用
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => {
            const empty: DraftValues = {
              user_id: '',
              model: '',
              from: '',
              to: '',
              tenant_id: '',
            };
            setDraft(empty);
            onChange(fromDraft(empty));
          }}
        >
          清空
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-1'>
      <Label className='text-12 text-fg-2'>{label}</Label>
      {children}
    </div>
  );
}

// DraftValues keeps inputs as raw strings so empty/typing-in-progress states
// don't get coerced to 0 prematurely — particularly important for datetime-
// local where parsing an empty string would lose user position.
type DraftValues = {
  user_id: string;
  model: string;
  from: string;
  to: string;
  tenant_id: string;
};

function toDraft(v: ChatHistoryFilterValues): DraftValues {
  return {
    user_id: v.user_id ? String(v.user_id) : '',
    model: v.model ?? '',
    from: v.from ? unixToLocalInput(v.from) : '',
    to: v.to ? unixToLocalInput(v.to) : '',
    tenant_id: v.tenant_id ? String(v.tenant_id) : '',
  };
}

function fromDraft(d: DraftValues): ChatHistoryFilterValues {
  return {
    user_id: parseIntOr0(d.user_id),
    model: d.model.trim(),
    from: d.from ? localInputToUnix(d.from) : 0,
    to: d.to ? localInputToUnix(d.to) : 0,
    tenant_id: parseIntOr0(d.tenant_id),
  };
}

function parseIntOr0(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function unixToLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  // datetime-local expects "YYYY-MM-DDTHH:mm" in the user's local TZ.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToUnix(s: string): number {
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
