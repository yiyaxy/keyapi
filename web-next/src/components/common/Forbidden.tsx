import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function Forbidden() {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-bg-0 px-4 text-center'>
      <ShieldAlert size={32} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('forbidden.title')}</h2>
      <p className='muted mt-2'>{t('forbidden.body')}</p>
      <Link to='/login' className='mt-6 text-13 text-accent hover:underline'>
        ← /login
      </Link>
    </div>
  );
}
