import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { applyTheme, getStoredTheme, type ThemeMode } from '@/lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation('shell');
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);
  useEffect(() => applyTheme(mode), [mode]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='flex items-center gap-2'>
        <Sun size={14} strokeWidth={1.5} />
        <span>{t('usermenu.theme')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
          <DropdownMenuRadioItem value='light'>
            <Sun size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='dark'>
            <Moon size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='system'>
            <Monitor size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
