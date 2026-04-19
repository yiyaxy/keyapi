import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogDetailDialog } from '@/components/logs/LogDetailDialog';
import {
  LogsAdminFilters,
  type AdminLogsFilterValues,
} from '@/components/logs/LogsAdminFilters';
import { LogsAdminTable } from '@/components/logs/LogsAdminTable';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminLogs, type LogRow } from '@/hooks/useLogs';

const PAGE_SIZE = 50;
const INITIAL: AdminLogsFilterValues = {
  type: 0,
  username: '',
  token_name: '',
  model_name: '',
  ip: '',
  channel: 0,
  request_id: '',
  start_timestamp: 0,
  end_timestamp: 0,
};

export function LogsAdminPage() {
  const { t } = useTranslation('logs');
  const [filters, setFilters] = useState<AdminLogsFilterValues>(INITIAL);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<LogRow | null>(null);

  const query = useAdminLogs({ ...filters, p: page, page_size: PAGE_SIZE });

  return (
    <div className='space-y-4'>
      <LogsAdminFilters
        value={filters}
        onChange={(v) => {
          setFilters(v);
          setPage(1);
        }}
      />
      {query.isError && (
        <InlineBanner
          level='danger'
          message={String((query.error as Error).message)}
          onClose={() => void query.refetch()}
        />
      )}
      {query.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-8 w-full' />
          ))}
        </div>
      ) : query.data?.items.length ? (
        <>
          <LogsAdminTable rows={query.data.items} onRowClick={setDetail} />
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('page.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('page.empty.body')}</div>
        </div>
      )}
      <LogDetailDialog
        open={Boolean(detail)}
        log={detail}
        onOpenChange={(o) => !o && setDetail(null)}
      />
    </div>
  );
}
