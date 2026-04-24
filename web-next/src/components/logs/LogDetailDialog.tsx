import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LogRow } from '@/hooks/useLogs';
import { fmtDateSec } from '@/lib/format';
import { parseOther } from './CostBreakdown';

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='grid grid-cols-[120px_1fr] items-baseline gap-3 border-b border-line py-2 text-13'>
      <dt className='text-fg-2'>{label}</dt>
      <dd className='break-all whitespace-pre-wrap font-mono text-fg-1'>{value || '-'}</dd>
    </div>
  );
}

function formatRatio(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '-';
  return `${Number(value.toFixed(4))}x`;
}

function stringifyDetail(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function LogDetailDialog({
  open,
  log,
  onOpenChange,
  isAdmin = false,
}: {
  open: boolean;
  log: LogRow | null;
  onOpenChange: (o: boolean) => void;
  isAdmin?: boolean;
}) {
  const { t } = useTranslation('logs');
  if (!log) return null;

  const other = parseOther(log.other);
  const markupSource = other.markup_source
    ? t(`detail.markup_source_value.${other.markup_source}`, {
        defaultValue: other.markup_source,
      })
    : '-';
  const requestLine =
    other.request_method && other.request_path
      ? `${other.request_method} ${other.request_path}`
      : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[760px]'>
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
        </DialogHeader>
        <dl className='max-h-[60vh] overflow-y-auto'>
          <Row label={t('table.col.time')} value={fmtDateSec(log.created_at)} />
          <Row label={t('detail.request_id')} value={log.request_id ?? ''} />
          <Row label='Request' value={requestLine} />
          <Row label={t('detail.channel')} value={log.channel_name || String(log.channel)} />
          <Row label={t('detail.group')} value={log.group} />
          <Row label={t('detail.ip')} value={log.ip} />
          <Row label={t('detail.is_stream')} value={log.is_stream ? 'Yes' : 'No'} />
          <Row label='Status' value={stringifyDetail(other.status_code)} />
          <Row label='Upstream status' value={stringifyDetail(other.upstream_status_code)} />
          <Row label='Error code' value={other.error_code ?? ''} />
          <Row label='Error type' value={other.error_type ?? ''} />
          <Row label='Error summary' value={other.error_summary ?? ''} />
          <Row label={t('detail.content')} value={log.content} />
          <Row
            label={t('detail.tenant_markup_ratio')}
            value={formatRatio(other.tenant_markup_ratio)}
          />
          <Row label={t('detail.markup_source')} value={markupSource} />
          {isAdmin ? (
            <>
              <Row label='Channel chain' value={other.admin_info?.channel_chain ?? ''} />
              <Row label='Retry count' value={stringifyDetail(other.admin_info?.retry_count)} />
              <Row
                label='Upstream request IDs'
                value={stringifyDetail(other.admin_info?.upstream_request_ids)}
              />
              <Row label='Base URL' value={other.admin_info?.channel_base_url ?? ''} />
              <Row label={t('detail.other')} value={log.other} />
            </>
          ) : null}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
