import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { ModelFormDialog } from '@/components/models/ModelFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import { useDeleteModelMeta, useModelsMeta, type ModelMeta } from '@/hooks/useModelsMeta';
import { fmtDateSec, fmtNum } from '@/lib/format';

const PAGE_SIZE = 30;

export function ModelsAdminPage() {
  const { t } = useTranslation('models');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [formTarget, setFormTarget] = useState<ModelMeta | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelMeta | null>(null);

  const list = useModelsMeta({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
  });
  const del = useDeleteModelMeta();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('page.create')}</Button>
      </PageAction>
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setAppliedKeyword(keyword);
              setPage(1);
            }
          }}
        />
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
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('col.id')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.name')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.tags')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.matched')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.updated')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2 text-fg-2'>{m.id}</td>
                    <td className='px-3 py-2 font-mono'>{m.model_name}</td>
                    <td className='px-3 py-2 text-fg-1'>{m.tags || '—'}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={m.status === 1 ? 'default' : 'secondary'}>
                        {t(m.status === 1 ? 'status.enabled' : 'status.disabled')}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>{fmtNum(m.matched_count ?? 0)}</td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(m.updated_time)}</td>
                    <td className='px-3 py-2'>
                      <div className='flex gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setFormTarget(m)}
                        >
                          {t('action.edit')}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-danger'
                          onClick={() => setDeleteTarget(m)}
                        >
                          {t('action.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <ModelFormDialog
        open={formTarget !== null}
        model={formTarget === 'new' || formTarget === null ? null : formTarget}
        onOpenChange={(o) => !o && setFormTarget(null)}
      />
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { name: deleteTarget.model_name })}
          confirmLabel={t('delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
