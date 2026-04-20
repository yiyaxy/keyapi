import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function TopbarSearchStub() {
  const { t } = useTranslation('shell');
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className='flex h-8 w-[280px] items-center gap-2 rounded-sm border border-line bg-bg-1 px-3 text-13 text-fg-2 hover:bg-bg-2'
          >
            <Search size={14} strokeWidth={1.5} />
            <span className='flex-1 text-left'>{t('search.placeholder')}</span>
            <kbd className='mono text-12 text-fg-2'>⌘K</kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('search.coming_soon')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
