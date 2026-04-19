import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AdminUser } from '@/hooks/useUsers';
import { fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const ROLE_COMMON = 1;
const ROLE_ADMIN = 10;
const ROLE_ROOT = 100;

function roleKey(role: number): 'root' | 'admin' | 'user' {
  if (role >= ROLE_ROOT) return 'root';
  if (role >= ROLE_ADMIN) return 'admin';
  return 'user';
}

export function UsersTable({
  items,
  onEdit,
  onDelete,
  onManage,
}: {
  items: AdminUser[];
  onEdit: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onManage: (u: AdminUser, action: 'enable' | 'disable' | 'promote' | 'demote') => void;
}) {
  const { t } = useTranslation('users');
  return (
    <div className='overflow-x-auto rounded-md border border-line'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>{t('table.col.id')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.username')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.display_name')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.email')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.role')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.status')}</th>
            <th className='px-3 py-2 font-medium'>{t('table.col.quota')}</th>
            <th className='px-3 py-2' />
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const role = roleKey(u.role);
            const isEnabled = u.status === 1;
            const isRoot = u.role >= ROLE_ROOT;
            return (
              <tr key={u.id} className='border-b border-line text-13 hover:bg-bg-1'>
                <td className='px-3 py-2 text-fg-2'>{u.id}</td>
                <td className='px-3 py-2 font-mono'>{u.username}</td>
                <td className='px-3 py-2'>{u.display_name || '—'}</td>
                <td className='px-3 py-2'>{u.email || '—'}</td>
                <td className='px-3 py-2'>
                  <Badge
                    variant={
                      role === 'root' ? 'default' : role === 'admin' ? 'secondary' : 'outline'
                    }
                  >
                    {t(`role.${role}`)}
                  </Badge>
                </td>
                <td className='px-3 py-2'>
                  <Badge variant={isEnabled ? 'default' : 'destructive'}>
                    {t(isEnabled ? 'status.enabled' : 'status.disabled')}
                  </Badge>
                </td>
                <td className='px-3 py-2'>{fmtMoney(u.quota / QUOTA_PER_UNIT)}</td>
                <td className='px-3 py-2'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='sm' aria-label='Actions'>
                        ⋯
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => onEdit(u)}>
                        {t('action.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onManage(u, isEnabled ? 'disable' : 'enable')}
                        disabled={isRoot}
                      >
                        {t(isEnabled ? 'action.disable' : 'action.enable')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onManage(u, u.role >= ROLE_ADMIN ? 'demote' : 'promote')}
                        disabled={isRoot}
                      >
                        {u.role >= ROLE_ADMIN ? t('action.demote') : t('action.promote')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onDelete(u)}
                        disabled={isRoot}
                        className='text-danger'
                      >
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

export { ROLE_COMMON, ROLE_ADMIN, ROLE_ROOT };
