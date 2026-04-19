import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Channel } from '@/hooks/useChannels';
import { channelTypeName } from '@/lib/channelTypes';

function statusBadge(status: number) {
  if (status === 1) return { label: 'status.enabled', variant: 'default' as const };
  if (status === 3) return { label: 'status.auto_disabled', variant: 'destructive' as const };
  return { label: 'status.manually_disabled', variant: 'secondary' as const };
}

export function ChannelsTable({
  items,
  testingId,
  onEdit,
  onDelete,
  onToggle,
  onTest,
}: {
  items: Channel[];
  testingId: number | null;
  onEdit: (c: Channel) => void;
  onDelete: (c: Channel) => void;
  onToggle: (c: Channel) => void;
  onTest: (c: Channel) => void;
}) {
  const { t } = useTranslation('channels');
  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('table.col.id')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.name')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.type')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.group')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.priority')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.response')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {items.map((ch) => {
            const badge = statusBadge(ch.status);
            const isTesting = testingId === ch.id;
            return (
              <tr key={ch.id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-2 text-fg-2'>{ch.id}</td>
                <td className='px-3 py-2'>{ch.name || '—'}</td>
                <td className='px-3 py-2'>{channelTypeName(ch.type)}</td>
                <td className='px-3 py-2'>{ch.group}</td>
                <td className='px-3 py-2'>{ch.priority ?? 0}</td>
                <td className='px-3 py-2'>
                  <Badge variant={badge.variant}>{t(badge.label)}</Badge>
                </td>
                <td className='px-3 py-2'>
                  {isTesting
                    ? t('test.pending')
                    : ch.response_time > 0
                      ? `${ch.response_time} ms`
                      : '—'}
                </td>
                <td className='px-3 py-2'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='sm' aria-label='Actions'>
                        ⋯
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => onEdit(ch)}>
                        {t('action.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onTest(ch)} disabled={isTesting}>
                        {t('action.test')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onToggle(ch)}>
                        {ch.status === 1 ? t('action.disable') : t('action.enable')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onDelete(ch)} className='text-danger'>
                        {t('action.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
