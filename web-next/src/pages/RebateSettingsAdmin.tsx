import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { RebateFormDialog } from '@/components/rebate/RebateFormDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useDeleteRebateSetting,
  useRebateSettings,
  type UserRebateSetting,
} from '@/hooks/useRebateSettings';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const PAGE_SIZE = 30;

export function RebateSettingsAdminPage() {
  const { t } = useTranslation('rebate');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [formTarget, setFormTarget] = useState<UserRebateSetting | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRebateSetting | null>(null);

  const list = useRebateSettings({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
  });
  const del = useDeleteRebateSetting();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('action.create')}</Button>
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
          {Array.from({ length: 5 }).map((_, i) => (
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
                  <th className='px-3 py-2 font-medium'>{t('col.inviter')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.register_reward')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.invitee_reward')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.top_up_rebate_count')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.top_up_rebate_percent')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.subscription_rebate_count')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.updated_at')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='px-3 py-2'>
                      <div className='font-mono'>{r.inviter_username || `#${r.inviter_id}`}</div>
                      <div className='text-12 text-fg-2'>#{r.inviter_id}</div>
                    </td>
                    <td className='px-3 py-2'>{fmtMoney(r.register_reward / QUOTA_PER_UNIT)}</td>
                    <td className='px-3 py-2'>{fmtMoney(r.invitee_reward / QUOTA_PER_UNIT)}</td>
                    <td className='px-3 py-2'>{fmtNum(r.top_up_rebate_count)}</td>
                    <td className='px-3 py-2'>{r.top_up_rebate_percent}%</td>
                    <td className='px-3 py-2'>{fmtNum(r.subscription_rebate_count)}</td>
                    <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.updated_at)}</td>
                    <td className='px-3 py-2'>
                      <div className='flex gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setFormTarget(r)}
                        >
                          {t('action.edit')}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='text-danger'
                          onClick={() => setDeleteTarget(r)}
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
      <RebateFormDialog
        open={formTarget !== null}
        record={formTarget === 'new' || formTarget === null ? null : formTarget}
        onOpenChange={(o) => !o && setFormTarget(null)}
      />
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { id: deleteTarget.inviter_id })}
          confirmLabel={t('delete.confirm')}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('toast.delete.success')),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
