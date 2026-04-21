import { Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { presignTicketAttachment, type TicketAttachment } from '@/hooks/useTickets';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function ReplyAttachments({
  attachments,
  admin,
}: {
  attachments: TicketAttachment[];
  admin?: boolean;
}) {
  const { t } = useTranslation('tickets');
  if (attachments.length === 0) return null;

  async function open(att: TicketAttachment) {
    try {
      const { url } = await presignTicketAttachment(att.id, { admin, disposition: 'inline' });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error((e as Error).message || t('attachments.open_failed'));
    }
  }

  return (
    <ul className='mt-2 space-y-1'>
      {attachments.map((a) => (
        <li key={a.id}>
          <button
            type='button'
            onClick={() => void open(a)}
            className='flex items-center gap-1 text-12 text-fg-1 hover:underline'
          >
            <Paperclip className='h-3 w-3' />
            <span className='truncate'>{a.original_filename}</span>
            <span className='text-fg-2 tabular-nums'>· {formatBytes(a.size_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
