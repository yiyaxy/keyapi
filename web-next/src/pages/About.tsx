import { useTranslation } from 'react-i18next';

export function AboutPage() {
  const { t } = useTranslation('public');
  return (
    <div className='mx-auto max-w-2xl space-y-6'>
      <h1 className='text-24 font-semibold'>{t('about.title')}</h1>
      <p className='text-14 leading-7 text-fg-1'>{t('about.body1')}</p>
      <p className='text-14 leading-7 text-fg-1'>{t('about.body2')}</p>
    </div>
  );
}
