import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAgentReportDetail,
  useAgentReports,
  useDeleteAgentReport,
  type AgentReport,
} from '@/hooks/useAgentReports';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'completed') return 'default';
  if (s === 'failed') return 'destructive';
  return 'secondary';
}

export function AgentReportAdminPage() {
  const { t } = useTranslation('agent');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [typeFilter, setTypeFilter] = useState('0');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentReport | null>(null);

  const list = useAgentReports({
    page,
    page_size: PAGE_SIZE,
    keyword: applied || undefined,
    report_type: typeFilter === '0' ? undefined : typeFilter,
  });
  const detail = useAgentReportDetail(detailId);
  const del = useDeleteAgentReport();

  const items = list.data ?? [];
  const hasNext = items.length >= PAGE_SIZE;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('report.search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setApplied(keyword);
              setPage(1);
            }
          }}
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[180px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('report.filter.type.all')}</SelectItem>
            <SelectItem value='daily'>{t('report.type.daily')}</SelectItem>
            <SelectItem value='weekly'>{t('report.type.weekly')}</SelectItem>
            <SelectItem value='monthly'>{t('report.type.monthly')}</SelectItem>
            <SelectItem value='trend'>{t('report.type.trend')}</SelectItem>
            <SelectItem value='manual'>{t('report.type.manual')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isError && (
        <InlineBanner
          level='danger'
          message={String((list.error as Error).message)}
          onClose={() => void list.refetch()}
        />
      )}
      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('report.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('report.col.title')}</th>
                  <th className='px-3 py-2 font-medium'>{t('report.col.type')}</th>
                  <th className='px-3 py-2 font-medium'>{t('report.col.agent')}</th>
                  <th className='px-3 py-2 font-medium'>{t('report.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>
                    {t('report.col.created')}
                  </th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='max-w-[360px] px-3 py-2'>
                      <div className='truncate font-medium'>{r.title}</div>
                      {r.summary && (
                        <div className='truncate text-12 text-fg-2'>{r.summary}</div>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant='outline'>
                        {t(`report.type.${r.report_type}`, {
                          defaultValue: r.report_type,
                        })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 font-mono text-12'>{r.agent_name}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(r.status)}>
                        {t(`report.status.${r.status}`, {
                          defaultValue: r.status,
                        })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>
                      {fmtDateSec(r.created_at)}
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setDetailId(r.id)}
                        >
                          {t('report.view')}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-danger'
                          onClick={() => setDeleteTarget(r)}
                        >
                          {t('report.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex items-center justify-end gap-2'>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('pagination.prev')}
            </Button>
            <span className='text-12 text-fg-2'>{page}</span>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </>
      )}
      <Dialog
        open={detailId !== null}
        onOpenChange={(o) => !o && setDetailId(null)}
      >
        <DialogContent className='max-w-[900px]'>
          <DialogHeader>
            <DialogTitle>
              {detail.data?.title || t('report.detail.title')}
            </DialogTitle>
          </DialogHeader>
          {detail.isPending ? (
            <div className='p-4 text-13 text-fg-2'>{t('report.detail.loading')}</div>
          ) : detail.data ? (
            <div className='space-y-3'>
              {detail.data.summary && (
                <div>
                  <div className='mb-1 text-12 text-fg-2'>
                    {t('report.detail.summary')}
                  </div>
                  <div className='text-13'>{detail.data.summary}</div>
                </div>
              )}
              {detail.data.html_content ? (
                <iframe
                  title={detail.data.title}
                  sandbox=''
                  srcDoc={detail.data.html_content}
                  className='h-[480px] w-full rounded-md border border-line bg-white'
                />
              ) : (
                <div className='rounded-md border border-line bg-bg-1 p-4 text-13 text-fg-2'>
                  {t('report.detail.no_content')}
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('report.delete.title')}
          body={t('report.delete.body', { title: deleteTarget.title })}
          confirmLabel={t('report.delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('report.toast.delete.success')),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
