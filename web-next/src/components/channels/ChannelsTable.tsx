import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChannelStabilityBadge } from '@/components/channels/ChannelStabilityBadge';
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

export function ChannelsTable({
  items,
  testingId,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  readOnly = false,
  showScope = false,
  showMarkup = false,
}: {
  items: Channel[];
  testingId: number | null;
  onEdit: (c: Channel) => void;
  onDelete: (c: Channel) => void;
  onToggle: (c: Channel) => void;
  onTest: (c: Channel) => void;
  readOnly?: boolean;
  showScope?: boolean;
  showMarkup?: boolean;
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
            {showScope ? <th className='px-3 py-2 font-medium'>{t('table.col.scope')}</th> : null}
            <th className='px-3 py-2 font-medium'>{t('table.col.priority')}</th>
            {showMarkup ? <th className='px-3 py-2 font-medium'>{t('table.col.markup')}</th> : null}
            <th className='px-3 py-2 font-medium'>{t('table.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.response')}</th>
            {!readOnly ? <th className='px-3 py-2' /> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((ch) => {
            const isTesting = testingId === ch.id;
            return (
              <tr key={ch.id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-2 text-fg-2'>{ch.id}</td>
                <td className='px-3 py-2'>{ch.name || '-'}</td>
                <td className='px-3 py-2'>{channelTypeName(ch.type)}</td>
                <td className='px-3 py-2'>{ch.group}</td>
                {showScope ? (
                  <td className='px-3 py-2'>
                    <Badge variant={ch.scope === 'platform' ? 'secondary' : 'outline'}>
                      {ch.scope ?? 'tenant'}
                    </Badge>
                  </td>
                ) : null}
                <td className='px-3 py-2'>{ch.priority ?? 0}</td>
                {showMarkup ? (
                  <td className='px-3 py-2 text-fg-2'>
                    {ch.markup_ratio && ch.markup_ratio > 0
                      ? `${ch.markup_ratio.toFixed(2)}x`
                      : 'plan'}
                  </td>
                ) : null}
                <td className='px-3 py-2'>
                  <ChannelStabilityBadge channel={ch} />
                </td>
                <td className='px-3 py-2'>
                  {isTesting
                    ? t('test.pending')
                    : ch.response_time > 0
                      ? `${ch.response_time} ms`
                      : '-'}
                </td>
                {!readOnly ? (
                  <td className='px-3 py-2'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='sm' aria-label='Actions'>
                          <MoreHorizontal className='h-4 w-4' />
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
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
