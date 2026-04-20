import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

import { UserMenu } from './UserMenu';

function initials(name: string | null | undefined, fallback: string) {
  const src = (name || fallback || '').trim();
  if (!src) return 'NA';
  const parts = src.split(/\s+/);
  const head = parts[0]?.[0] ?? '';
  const tail = parts.length > 1 ? parts[parts.length - 1]?.[0] : (parts[0]?.[1] ?? '');
  return (head + tail).toUpperCase() || 'NA';
}

export function UserChip() {
  const { user } = useAuth();
  if (!user) return null;
  const label = user.display_name || user.username;
  const second = `${user.tenant_id ? `Tenant #${user.tenant_id}` : ''}${user.group ? ` · ${user.group}` : ''}`;
  return (
    <UserMenu>
      <button
        type='button'
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-bg-1'
        )}
      >
        <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-accent-soft mono text-12 font-semibold text-fg-0'>
          {initials(user.display_name, user.username)}
        </span>
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-13 text-fg-0'>{label}</span>
          <span className='block truncate text-12 text-fg-2'>{second}</span>
        </span>
      </button>
    </UserMenu>
  );
}
