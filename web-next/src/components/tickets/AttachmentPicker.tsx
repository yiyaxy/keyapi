import { Paperclip, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { TICKET_MAX_ATTACHMENTS } from '@/hooks/useTickets';

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

export function AttachmentPicker({
  files,
  onChange,
  disabled,
  accept = 'image/*',
  max = TICKET_MAX_ATTACHMENTS,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
  max?: number;
}) {
  const { t } = useTranslation('tickets');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const atLimit = files.length >= max;

  function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const room = Math.max(0, max - files.length);
    const next = [...files, ...incoming.slice(0, room)];
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(idx: number) {
    const next = files.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div className='space-y-2'>
      <input
        ref={inputRef}
        type='file'
        multiple
        accept={accept}
        className='hidden'
        onChange={(e) => onPick(e.target.files)}
      />
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={disabled || atLimit}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className='mr-1 h-3.5 w-3.5' />
          {t('attachments.pick')}
        </Button>
        <div className='text-12 text-fg-2'>
          {t('attachments.hint', { count: files.length, max })}
        </div>
      </div>
      {files.length > 0 && (
        <ul className='space-y-1'>
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className='flex items-center justify-between gap-2 rounded-md border border-line bg-bg-1 px-2 py-1 text-12'
            >
              <span className='truncate text-fg-1'>{f.name}</span>
              <div className='flex shrink-0 items-center gap-2'>
                <span className='text-fg-2 tabular-nums'>{formatBytes(f.size)}</span>
                <button
                  type='button'
                  className='text-fg-2 hover:text-fg-0'
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={t('attachments.remove')}
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
