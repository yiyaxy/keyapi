import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { MessageFormDialog } from '@/components/message/MessageFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  MESSAGE_STATUS,
  MESSAGE_TYPE,
  useAdminMessages,
  useRecallMessage,
  type AdminMessage,
} from '@/hooks/useMessages';
import { fmtDateSec } from '@/lib/format';

const PAGE_SIZE = 30;

export function MessageAdminPage() {
  const { t } = useTranslation('message');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('0');
  const [formTarget, setFormTarget] = useState<AdminMessage | 'new' | null>(
    null
  );
  const [recallTarget, setRecallTarget] = useState<AdminMessage | null>(null);

  const list = useAdminMessages({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
    type: typeFilter === '0' ? undefined : Number(typeFilter),
  });
  const recall = useRecallMessage();

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
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('filter.type.all')}</SelectItem>
            <SelectItem value={String(MESSAGE_TYPE.DIRECTED)}>
              {t('filter.type.directed')}
            </SelectItem>
            <SelectItem value={String(MESSAGE_TYPE.BROADCAST)}>
              {t('filter.type.broadcast')}
            </SelectItem>
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
          {t('empty')}
        </div>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border border-line'>
            <table className='w-full border-collapse tabular-nums'>
              <thead>
                <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                  <th className='px-3 py-2 font-medium'>{t('col.title')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.type')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.target')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.created')}</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className='border-b border-line text-13 hover:bg-bg-1'>
                    <td className='max-w-[320px] px-3 py-2'>
                      <div className='truncate font-medium'>{m.title}</div>
                      <div className='text-12 text-fg-2'>#{m.id}</div>
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant='secondary'>
                        {t(
                          m.type === MESSAGE_TYPE.BROADCAST
                            ? 'type.broadcast'
                            : 'type.directed'
                        )}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>
                      {m.type === MESSAGE_TYPE.BROADCAST
                        ? t('target.all')
                        : t('target.user', { id: m.target_user_id })}
                    </td>
                    <td className='px-3 py-2'>
                      <Badge
                        variant={
                          m.status === MESSAGE_STATUS.NORMAL
                            ? 'default'
                            : 'outline'
                        }
                      >
                        {t(
                          m.status === MESSAGE_STATUS.NORMAL
                            ? 'status.normal'
                            : 'status.recalled'
                        )}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-1'>
                      {fmtDateSec(m.created_at)}
                    </td>
                    <td className='px-3 py-2'>
                      {m.status === MESSAGE_STATUS.NORMAL && (
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
                            onClick={() => setRecallTarget(m)}
                          >
                            {t('action.recall')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
        </>
      )}
      <MessageFormDialog
        open={formTarget !== null}
        record={formTarget === 'new' || formTarget === null ? null : formTarget}
        onOpenChange={(o) => !o && setFormTarget(null)}
      />
      {recallTarget && (
        <ConfirmDialog
          open
          title={t('recall.title')}
          body={t('recall.body', { title: recallTarget.title })}
          confirmLabel={t('recall.confirm')}
          isPending={recall.isPending}
          onOpenChange={(o) => !o && setRecallTarget(null)}
          onConfirm={() => {
            const target = recallTarget;
            setRecallTarget(null);
            recall.mutate(target.id, {
              onSuccess: () => toast.success(t('toast.recall.success')),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
