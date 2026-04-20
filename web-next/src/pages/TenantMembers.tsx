import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { InviteMemberDialog } from '@/components/tenant/InviteMemberDialog';
import { TenantMembersTable } from '@/components/tenant/TenantMembersTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useRemoveMember,
  useTenantMembers,
  useUpdateMember,
  type TenantMember,
} from '@/hooks/useTenant';

const PAGE_SIZE = 50;

export function TenantMembersPage() {
  const { t } = useTranslation('tenant');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TenantMember | null>(null);

  const members = useTenantMembers({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
  });
  const update = useUpdateMember();
  const remove = useRemoveMember();

  const items = members.data?.items ?? [];
  const total = members.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setInviteOpen(true)}>{t('members.page.invite')}</Button>
      </PageAction>
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('members.search')}
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
      {members.isError && (
        <InlineBanner
          level='danger'
          message={String((members.error as Error).message)}
          onClose={() => void members.refetch()}
        />
      )}
      {members.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('members.empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('members.empty.body')}</div>
        </div>
      ) : (
        <>
          <TenantMembersTable
            items={items}
            onRemove={setRemoveTarget}
            onManage={(m, change) =>
              update.mutate(
                { user_id: m.user_id, ...change },
                { onError: (e) => toast.error((e as Error).message) }
              )
            }
          />
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {removeTarget && (
        <ConfirmDialog
          open
          title={t('remove.title')}
          body={t('remove.body', {
            name: removeTarget.user?.username ?? `#${removeTarget.user_id}`,
          })}
          confirmLabel={t('remove.confirm')}
          isPending={remove.isPending}
          onOpenChange={(o) => !o && setRemoveTarget(null)}
          onConfirm={() => {
            const target = removeTarget;
            setRemoveTarget(null);
            remove.mutate(target.user_id, {
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
