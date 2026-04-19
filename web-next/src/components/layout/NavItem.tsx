import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';

type Props = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export function NavItem({ to, label, icon: Icon, badge }: Props) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2 rounded-sm px-2 text-13 transition-colors',
          isActive ? 'bg-bg-2 text-fg-0' : 'text-fg-1 hover:bg-bg-1 hover:text-fg-0'
        )
      }
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className='flex-1 truncate'>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className='rounded-full bg-primary px-1.5 py-0.5 text-11 font-medium leading-none text-primary-foreground'>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}
