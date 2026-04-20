import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ComingSoon({ feature }: { feature: string }) {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center text-center'>
      <Construction size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('coming_soon.title', { feature })}</h2>
      <p className='muted mt-2 max-w-md'>{t('coming_soon.body')}</p>
    </div>
  );
}
