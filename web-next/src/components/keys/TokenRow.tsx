import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import type { Token } from '@/hooks/useTokens';
import { fmtDateSec, fmtDisplay } from '@/lib/format';
import { parseGroupChain } from '@/lib/token-schema';

import { KeyCell } from './KeyCell';

function statusBadge(status: number) {
  if (status === 2) return 'disabled';
  if (status === 3) return 'expired';
  if (status === 4) return 'exhausted';
  return null;
}

type Props = {
  token: Token;
  onEdit: (token: Token) => void;
  onDelete: (token: Token) => void;
  onToggleStatus: (token: Token) => void;
};

export function TokenRow({ token, onEdit, onDelete, onToggleStatus }: Props) {
  const { t } = useTranslation('keys');
  const cfg = usePublicConfig();
  const groups = parseGroupChain(token.group);
  const chainLabel = groups.length <= 1 ? (groups[0] ?? 'auto') : groups.join(' → ');
  const badge = statusBadge(token.status);
  const disabled = token.status !== 1;

  const total = token.remain_quota + token.used_quota;
  const usage = token.unlimited_quota
    ? t('status.unlimited')
    : total === 0
      ? '—'
      : `${fmtDisplay(token.used_quota, cfg)} / ${fmtDisplay(total, cfg)}`;

  return (
    <tr className={disabled ? 'opacity-60' : ''}>
      <td className='px-4 py-3'>
        <div className='text-13 font-medium text-fg-0'>{token.name || t('token.untitled')}</div>
        <div className='text-12 text-fg-2'>{chainLabel}</div>
      </td>
      <td className='px-4 py-3'>
        <KeyCell tokenId={token.id} masked={token.key ?? '••••'} />
      </td>
      <td className='px-4 py-3 text-13'>
        <div className='flex items-center gap-2'>
          <span>{usage}</span>
          {badge && <Badge variant='secondary'>{t(`status.${badge}`)}</Badge>}
        </div>
      </td>
      <td className='px-4 py-3 text-13 text-fg-1'>{fmtDateSec(token.created_time)}</td>
      <td className='px-4 py-3 text-right'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' aria-label={t('menu.actions')}>
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onEdit(token)}>{t('menu.edit')}</DropdownMenuItem>
            {(token.status === 1 || token.status === 2) && (
              <DropdownMenuItem onClick={() => onToggleStatus(token)}>
                {token.status === 1 ? t('status.disabled') : t('status.enabled')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(token)} className='text-destructive'>
              {t('delete.confirm')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
