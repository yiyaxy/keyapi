import { LogOut, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

import { LangToggle } from './LangToggle';
import { ThemeToggle } from './ThemeToggle';

export function UserMenu({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('shell');
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='top' sideOffset={6} className='w-56'>
        <ThemeToggle />
        <LangToggle />
        <DropdownMenuItem onClick={() => navigate('/account')}>
          <UserCog size={14} strokeWidth={1.5} className='mr-2' />
          {t('usermenu.account')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut size={14} strokeWidth={1.5} className='mr-2' />
          {t('usermenu.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
