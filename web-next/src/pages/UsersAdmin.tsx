import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateUserDialog } from '@/components/users/CreateUserDialog';
import { EditUserDialog } from '@/components/users/EditUserDialog';
import { UsersTable } from '@/components/users/UsersTable';
import { PageAction } from '@/hooks/usePageAction';
import { useAdminUsers, useManageUser, type AdminUser, type ManageAction } from '@/hooks/useUsers';

const PAGE_SIZE = 50;

export function UsersAdminPage() {
  const { t } = useTranslation('users');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const users = useAdminUsers({
    p: page,
    page_size: PAGE_SIZE,
    keyword: appliedKeyword || undefined,
  });
  const manage = useManageUser();

  const items = users.data?.items ?? [];
  const total = users.data?.total ?? 0;

  function runManage(u: AdminUser, action: ManageAction) {
    manage.mutate(
      { id: u.id, action },
      {
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setCreateOpen(true)}>{t('page.create')}</Button>
      </PageAction>
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('filters.search')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setAppliedKeyword(keyword);
              setPage(1);
            }
          }}
        />
        <Button
          variant='secondary'
          onClick={() => {
            setAppliedKeyword(keyword);
            setPage(1);
          }}
        >
          {t('filters.search')}
        </Button>
      </div>
      {users.isError && (
        <InlineBanner
          level='danger'
          message={String((users.error as Error).message)}
          onClose={() => void users.refetch()}
        />
      )}
      {users.isPending ? (
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
          <UsersTable
            items={items}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
            onManage={runManage}
          />
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <EditUserDialog open user={editTarget} onOpenChange={(o) => !o && setEditTarget(null)} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open
          title={t('delete.title')}
          body={t('delete.body', { name: deleteTarget.username })}
          confirmLabel={t('delete.confirm')}
          isPending={manage.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            manage.mutate(
              { id: target.id, action: 'delete' },
              {
                onSuccess: () => toast.success(t('delete.confirm') + ' ✓'),
                onError: (err) => toast.error((err as Error).message),
              }
            );
          }}
        />
      )}
    </div>
  );
}
