import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TenantMember } from '@/hooks/useTenant';
import { fmtDateSec } from '@/lib/format';

const ROLE_MEMBER = 1;
const ROLE_ADMIN = 10;

type StatusMeta = {
  key: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
};

function statusMeta(status: number): StatusMeta {
  switch (status) {
    case 1:
      return { key: 'members.status.active', variant: 'default' };
    case 2:
      return { key: 'members.status.disabled', variant: 'destructive' };
    case 3:
      return { key: 'members.status.removed', variant: 'secondary' };
    case 4:
      return { key: 'members.status.invited', variant: 'outline' };
    default:
      return { key: 'members.status.active', variant: 'outline' };
  }
}

export function TenantMembersTable({
  items,
  onRemove,
  onManage,
}: {
  items: TenantMember[];
  onRemove: (m: TenantMember) => void;
  onManage: (m: TenantMember, change: { role?: number; status?: number }) => void;
}) {
  const { t } = useTranslation('tenant');
  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('members.col.user')}</th>
            <th className='px-3 py-2 font-medium'>{t('members.col.email')}</th>
            <th className='px-3 py-2 font-medium'>{t('members.col.role')}</th>
            <th className='px-3 py-2 font-medium'>{t('members.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('members.col.joined')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {items.map((m) => {
            const status = statusMeta(m.status);
            const isAdmin = m.role >= ROLE_ADMIN;
            const isEnabled = m.status === 1;
            return (
              <tr key={m.id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-2'>
                  <div className='font-mono'>{m.user?.username ?? `#${m.user_id}`}</div>
                  {m.user?.display_name && (
                    <div className='text-12 text-fg-2'>{m.user.display_name}</div>
                  )}
                </td>
                <td className='px-3 py-2'>{m.user?.email ?? '—'}</td>
                <td className='px-3 py-2'>
                  <Badge variant={isAdmin ? 'secondary' : 'outline'}>
                    {t(isAdmin ? 'members.role.admin' : 'members.role.member')}
                  </Badge>
                </td>
                <td className='px-3 py-2'>
                  <Badge variant={status.variant}>{t(status.key)}</Badge>
                </td>
                <td className='px-3 py-2 text-fg-1'>{fmtDateSec(m.created_at)}</td>
                <td className='px-3 py-2'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='sm' aria-label='Actions'>
                        ⋯
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onSelect={() => onManage(m, { role: isAdmin ? ROLE_MEMBER : ROLE_ADMIN })}
                      >
                        {t(isAdmin ? 'members.action.demote' : 'members.action.promote')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onManage(m, { status: isEnabled ? 2 : 1 })}>
                        {t(isEnabled ? 'members.action.disable' : 'members.action.enable')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onRemove(m)} className='text-danger'>
                        {t('members.action.remove')}
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
