import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { LogRow } from '@/hooks/useLogs';
import { fmtDateSec } from '@/lib/format';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='grid grid-cols-[120px_1fr] items-baseline gap-3 border-b border-line py-2 text-13'>
      <dt className='text-fg-2'>{label}</dt>
      <dd className='break-all font-mono text-fg-1'>{value || '—'}</dd>
    </div>
  );
}

export function LogDetailDialog({
  open,
  log,
  onOpenChange,
}: {
  open: boolean;
  log: LogRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('logs');
  if (!log) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
        </DialogHeader>
        <dl className='max-h-[60vh] overflow-y-auto'>
          <Row label={t('table.col.time')} value={fmtDateSec(log.created_at)} />
          <Row label={t('detail.request_id')} value={log.request_id ?? ''} />
          <Row label={t('detail.channel')} value={log.channel_name || String(log.channel)} />
          <Row label={t('detail.group')} value={log.group} />
          <Row label={t('detail.ip')} value={log.ip} />
          <Row label={t('detail.is_stream')} value={log.is_stream ? '✓' : '—'} />
          <Row label={t('detail.content')} value={log.content} />
          <Row label={t('detail.other')} value={log.other} />
        </dl>
      </DialogContent>
    </Dialog>
  );
}
