import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFound() {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center text-center'>
      <h2 className='h3'>{t('not_found.title')}</h2>
      <p className='muted mt-2'>{t('not_found.body')}</p>
      <Link to='/' className='mt-6 text-13 text-accent hover:underline'>
        {t('not_found.home')}
      </Link>
    </div>
  );
}
