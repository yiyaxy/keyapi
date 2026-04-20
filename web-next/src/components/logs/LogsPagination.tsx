import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export function LogsPagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const { t } = useTranslation('logs');
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className='flex items-center justify-between py-3 text-13 text-fg-2'>
      <div>{t('pagination.total', { total })}</div>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          {t('pagination.prev')}
        </Button>
        <span className='tabular-nums'>{t('pagination.page', { page })}</span>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page >= lastPage}
          onClick={() => onChange(page + 1)}
        >
          {t('pagination.next')}
        </Button>
      </div>
    </div>
  );
}
