import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export function EmptyKeys({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation('keys');
  return (
    <div className='flex min-h-[40vh] flex-col items-center justify-center text-center'>
      <KeyRound size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('page.empty.title')}</h2>
      <p className='muted mt-2 max-w-md'>{t('page.empty.body')}</p>
      <Button className='mt-6' onClick={onCreate}>
        {t('page.empty.cta')}
      </Button>
    </div>
  );
}
