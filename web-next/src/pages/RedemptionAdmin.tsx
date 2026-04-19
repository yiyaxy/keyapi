import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { CreateRedemptionDialog } from '@/components/redemption/CreateRedemptionDialog';
import { RedemptionsTable } from '@/components/redemption/RedemptionsTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useDeleteInvalidRedemptions,
  useDeleteRedemption,
  useRedemptions,
  type Redemption,
} from '@/hooks/useRedemptions';

const PAGE_SIZE = 50;

export function RedemptionAdminPage() {
  const { t } = useTranslation('redemption');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Redemption | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const redemptions = useRedemptions({ p: page, page_size: PAGE_SIZE });
  const del = useDeleteRedemption();
  const cleanup = useDeleteInvalidRedemptions();

  const items = redemptions.data?.items ?? [];
  const total = redemptions.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <div className='flex gap-2'>
          <Button variant='secondary' onClick={() => setCleanupOpen(true)}>
            {t('page.cleanup')}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>{t('page.create')}</Button>
        </div>
      </PageAction>
      {redemptions.isError && (
        <InlineBanner
          level='danger'
          message={String((redemptions.error as Error).message)}
          onClose={() => void redemptions.refetch()}
        />
      )}
      {redemptions.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('page.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('page.empty.body')}</div>
        </div>
      ) : (
        <>
          <RedemptionsTable items={items} onDelete={setDeleteTarget} />
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
        </>
      )}
      <CreateRedemptionDialog open={createOpen} onOpenChange={setCreateOpen} />
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { name: deleteTarget.name })}
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
      <ConfirmDialog
        open={cleanupOpen}
        title={t('page.cleanup_confirm.title')}
        body={t('page.cleanup_confirm.body')}
        confirmLabel={t('page.cleanup_confirm.action')}
        isPending={cleanup.isPending}
        onOpenChange={setCleanupOpen}
        onConfirm={() => {
          setCleanupOpen(false);
          cleanup.mutate(undefined, {
            onError: (e) => toast.error((e as Error).message),
          });
        }}
      />
    </div>
  );
}
