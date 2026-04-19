import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import type { LogType } from '@/hooks/useLogs';

export type AdminLogsFilterValues = {
  type: LogType;
  username: string;
  token_name: string;
  model_name: string;
  ip: string;
  channel: number;
  request_id: string;
  start_timestamp: number;
  end_timestamp: number;
};

const EMPTY: AdminLogsFilterValues = {
  type: 0,
  username: '',
  token_name: '',
  model_name: '',
  ip: '',
  channel: 0,
  request_id: '',
  start_timestamp: 0,
  end_timestamp: 0,
};

function secToLocalInput(sec: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToSec(s: string): number {
  if (!s) return 0;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : 0;
}

export function LogsAdminFilters({
  value,
  onChange,
}: {
  value: AdminLogsFilterValues;
  onChange: (v: AdminLogsFilterValues) => void;
}) {
  const { t } = useTranslation('logs');
  const [draft, setDraft] = useState<AdminLogsFilterValues>(value);
  const apply = () => onChange(draft);
  const clear = () => {
    setDraft(EMPTY);
    onChange(EMPTY);
  };
  return (
    <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
      <div className='space-y-1'>
        <Label>{t('filters.type.all')}</Label>
        <Select
          value={String(draft.type)}
          onValueChange={(v) => setDraft((d) => ({ ...d, type: Number(v) as LogType }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('filters.type.all')}</SelectItem>
            <SelectItem value='1'>{t('filters.type.topup')}</SelectItem>
            <SelectItem value='2'>{t('filters.type.consume')}</SelectItem>
            <SelectItem value='3'>{t('filters.type.manage')}</SelectItem>
            <SelectItem value='4'>{t('filters.type.system')}</SelectItem>
            <SelectItem value='5'>{t('filters.type.error')}</SelectItem>
            <SelectItem value='6'>{t('filters.type.refund')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1'>
        <Label>{t('admin.filters.username')}</Label>
        <Input
          value={draft.username}
          onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('filters.token')}</Label>
        <Input
          value={draft.token_name}
          onChange={(e) => setDraft((d) => ({ ...d, token_name: e.target.value }))}
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('filters.model')}</Label>
        <Input
          value={draft.model_name}
          onChange={(e) => setDraft((d) => ({ ...d, model_name: e.target.value }))}
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('admin.filters.ip')}</Label>
        <Input value={draft.ip} onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))} />
      </div>
      <div className='space-y-1'>
        <Label>{t('admin.filters.channel')}</Label>
        <Input
          type='number'
          min={0}
          value={draft.channel || ''}
          onChange={(e) => setDraft((d) => ({ ...d, channel: Number(e.target.value) || 0 }))}
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('filters.request_id')}</Label>
        <Input
          value={draft.request_id}
          onChange={(e) => setDraft((d) => ({ ...d, request_id: e.target.value }))}
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('filters.start')}</Label>
        <Input
          type='datetime-local'
          value={secToLocalInput(draft.start_timestamp)}
          onChange={(e) =>
            setDraft((d) => ({ ...d, start_timestamp: localInputToSec(e.target.value) }))
          }
        />
      </div>
      <div className='space-y-1'>
        <Label>{t('filters.end')}</Label>
        <Input
          type='datetime-local'
          value={secToLocalInput(draft.end_timestamp)}
          onChange={(e) =>
            setDraft((d) => ({ ...d, end_timestamp: localInputToSec(e.target.value) }))
          }
        />
      </div>
      <div className='flex items-end gap-2 md:col-span-4'>
        <Button type='button' onClick={apply}>
          {t('filters.apply')}
        </Button>
        <Button type='button' variant='secondary' onClick={clear}>
          {t('filters.clear')}
        </Button>
      </div>
    </div>
  );
}
