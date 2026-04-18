import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

export function LangToggle() {
  const { i18n, t } = useTranslation('shell');

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='flex items-center gap-2'>
        <Languages size={14} strokeWidth={1.5} />
        <span>{t('usermenu.language')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
          onValueChange={(v) => void i18n.changeLanguage(v)}
        >
          <DropdownMenuRadioItem value='zh'>{t('lang.zh')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='en'>{t('lang.en')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
