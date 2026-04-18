import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { logError } from '@/lib/observability';

export function RouteErrorFallback() {
  const err = useRouteError();
  const { t } = useTranslation('shell');
  logError(err, { tag: 'route-error' });
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-bg-0 px-4 text-center'>
      <h2 className='h3'>{t('error_boundary.title')}</h2>
      <p className='muted mt-2 max-w-md'>{t('error_boundary.body')}</p>
      <Button className='mt-6' onClick={() => window.location.reload()}>
        <RotateCcw size={14} strokeWidth={1.5} className='mr-2' /> {t('error_boundary.reload')}
      </Button>
    </div>
  );
}
