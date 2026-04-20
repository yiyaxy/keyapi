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
  useAgentLogs,
  useDeleteAgentLog,
  type AgentLog,
} from '@/hooks/useAgentLogs';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'success') return 'default';
  if (s === 'failed') return 'destructive';
  return 'secondary';
}

export function AgentLogAdminPage() {
  const { t } = useTranslation('agent');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [category, setCategory] = useState('0');
  const [status, setStatus] = useState('0');
  const [detailTarget, setDetailTarget] = useState<AgentLog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentLog | null>(null);

  const list = useAgentLogs({
    page,
    page_size: PAGE_SIZE,
    keyword: applied || undefined,
    category: category === '0' ? undefined : category,
    status: status === '0' ? undefined : status,
  });
  const del = useDeleteAgentLog();

  const items = list.data ?? [];
  const hasNext = items.length >= PAGE_SIZE;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('log.search.placeholder')}
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
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('log.filter.category.all')}</SelectItem>
            <SelectItem value='production'>
              {t('log.filter.category.production')}
            </SelectItem>
            <SelectItem value='local'>{t('log.filter.category.local')}</SelectItem>
            <SelectItem value='readonly'>
              {t('log.filter.category.readonly')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('log.filter.status.all')}</SelectItem>
            <SelectItem value='running'>{t('log.filter.status.running')}</SelectItem>
            <SelectItem value='success'>{t('log.filter.status.success')}</SelectItem>
            <SelectItem value='failed'>{t('log.filter.status.failed')}</SelectItem>
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
          {t('log.empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('log.col.time')}</th>
                  <th className='px-3 py-2 font-medium'>{t('log.col.agent')}</th>
                  <th className='px-3 py-2 font-medium'>{t('log.col.category')}</th>
                  <th className='px-3 py-2 font-medium'>{t('log.col.action')}</th>
                  <th className='px-3 py-2 font-medium'>{t('log.col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('log.col.admin')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-1'>
                      {fmtDateSec(l.created_at)}
                    </td>
                    <td className='px-3 py-2 font-mono text-12'>{l.agent_name}</td>
                    <td className='px-3 py-2'>
                      <Badge variant='outline'>{l.category}</Badge>
                    </td>
                    <td className='max-w-[320px] truncate px-3 py-2 font-mono text-12'>
                      {l.action}
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(l.status)}>
                        {t(`log.filter.status.${l.status}`, {
                          defaultValue: l.status,
                        })}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-2'>#{l.admin_id}</td>
                    <td className='px-3 py-2'>
                      <div className='flex gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setDetailTarget(l)}
                        >
                          {t('log.view_detail')}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-danger'
                          onClick={() => setDeleteTarget(l)}
                        >
                          {t('log.delete')}
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
        open={detailTarget !== null}
        onOpenChange={(o) => !o && setDetailTarget(null)}
      >
        <DialogContent className='max-w-[720px]'>
          <DialogHeader>
            <DialogTitle>{t('log.detail.title')}</DialogTitle>
          </DialogHeader>
          {detailTarget && (
            <div className='space-y-3 text-13'>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <div className='text-12 text-fg-2'>
                    {t('log.detail.field.agent')}
                  </div>
                  <div className='font-mono'>{detailTarget.agent_name}</div>
                </div>
                <div>
                  <div className='text-12 text-fg-2'>
                    {t('log.detail.field.category')}
                  </div>
                  <div>{detailTarget.category}</div>
                </div>
                <div className='col-span-2'>
                  <div className='text-12 text-fg-2'>
                    {t('log.detail.field.action')}
                  </div>
                  <div className='font-mono break-words'>{detailTarget.action}</div>
                </div>
                {detailTarget.description && (
                  <div className='col-span-2'>
                    <div className='text-12 text-fg-2'>
                      {t('log.detail.field.description')}
                    </div>
                    <div>{detailTarget.description}</div>
                  </div>
                )}
                <div>
                  <div className='text-12 text-fg-2'>
                    {t('log.detail.field.status')}
                  </div>
                  <Badge variant={statusVariant(detailTarget.status)}>
                    {t(`log.filter.status.${detailTarget.status}`, {
                      defaultValue: detailTarget.status,
                    })}
                  </Badge>
                </div>
              </div>
              <div>
                <div className='mb-1 text-12 text-fg-2'>
                  {t('log.detail.field.detail')}
                </div>
                <pre className='max-h-[320px] overflow-auto rounded-md border border-line bg-bg-1 p-2 text-12 font-mono whitespace-pre-wrap break-words'>
                  {detailTarget.detail || '—'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('log.delete.title')}
          body={t('log.delete.body', { id: deleteTarget.id })}
          confirmLabel={t('log.delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('log.toast.delete.success')),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
