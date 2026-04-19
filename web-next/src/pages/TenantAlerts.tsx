import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAckAlert,
  useResolveAlert,
  useTenantAlertHistory,
  useTenantAlerts,
  type TenantAlert,
} from '@/hooks/useTenantAlerts';
import { fmtDateSec } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;

function severityVariant(
  severity: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'warning':
      return 'secondary';
    case 'info':
      return 'outline';
    default:
      return 'outline';
  }
}

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'destructive';
    case 'acknowledged':
      return 'secondary';
    case 'resolved':
      return 'default';
    default:
      return 'outline';
  }
}

export function TenantAlertsPage() {
  const { t } = useTranslation('tenant');
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [page, setPage] = useState(1);

  const active = useTenantAlerts();
  const history = useTenantAlertHistory({ p: page, page_size: PAGE_SIZE });
  const ack = useAckAlert();
  const resolve = useResolveAlert();

  const items: TenantAlert[] =
    tab === 'active' ? (active.data ?? []) : (history.data?.items ?? []);
  const total = tab === 'history' ? (history.data?.total ?? 0) : items.length;
  const isPending = tab === 'active' ? active.isPending : history.isPending;
  const isError = tab === 'active' ? active.isError : history.isError;
  const error = tab === 'active' ? active.error : history.error;

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2 border-b border-line'>
        <TabButton label={t('alerts.tab.active')} active={tab === 'active'} onClick={() => setTab('active')} />
        <TabButton label={t('alerts.tab.history')} active={tab === 'history'} onClick={() => { setTab('history'); setPage(1); }} />
      </div>
      {isError && (
        <InlineBanner
          level='danger'
          message={String((error as Error).message)}
          onClose={() => {
            if (tab === 'active') void active.refetch();
            else void history.refetch();
          }}
        />
      )}
      {isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('alerts.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('alerts.col.severity')}</th>
                  <th className='px-3 py-2 font-medium'>{t('alerts.col.type')}</th>
                  <th className='px-3 py-2 font-medium'>{t('alerts.col.message')}</th>
                  <th className='px-3 py-2 font-medium'>{t('alerts.col.triggered')}</th>
                  <th className='px-3 py-2 font-medium'>{t('alerts.col.status')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2'>
                      <Badge variant={severityVariant(a.severity)}>
                        {t(`alerts.severity.${a.severity}`, { defaultValue: a.severity })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 font-mono text-12'>{a.alert_type}</td>
                    <td className='px-3 py-2 text-fg-1'>{a.message}</td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(a.triggered_at)}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(a.status)}>
                        {t(`alerts.status.${a.status}`, { defaultValue: a.status })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>
                      {a.status === 'active' && (
                        <div className='flex gap-1'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={ack.isPending}
                            onClick={() =>
                              ack.mutate(a.id, {
                                onError: (e) => toast.error((e as Error).message),
                              })
                            }
                          >
                            {t('alerts.action.ack')}
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={resolve.isPending}
                            onClick={() =>
                              resolve.mutate(a.id, {
                                onError: (e) => toast.error((e as Error).message),
                              })
                            }
                          >
                            {t('alerts.action.resolve')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tab === 'history' && (
            <LogsPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-13 transition-colors',
        active
          ? 'border-primary text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      )}
    >
      {label}
    </button>
  );
}
