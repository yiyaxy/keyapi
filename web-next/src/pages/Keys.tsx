import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { CreateTokenDialog } from '@/components/keys/CreateTokenDialog';
import { DeleteConfirmDialog } from '@/components/keys/DeleteConfirmDialog';
import { EditTokenSheet } from '@/components/keys/EditTokenSheet';
import { EmptyKeys } from '@/components/keys/EmptyKeys';
import { KeysTable } from '@/components/keys/KeysTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageAction } from '@/hooks/usePageAction';
import {
  useDeleteToken,
  useToggleTokenStatus,
  useTokensQuery,
  type Token,
} from '@/hooks/useTokens';

export function KeysPage() {
  const { t } = useTranslation('keys');
  const tokens = useTokensQuery(1);
  const del = useDeleteToken();
  const toggle = useToggleTokenStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Token | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Token | null>(null);

  if (tokens.isPending) {
    return (
      <>
        <PageAction>
          <Button disabled>{t('page.create')}</Button>
        </PageAction>
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      </>
    );
  }
  if (tokens.isError) {
    return (
      <InlineBanner
        level='danger'
        message={String((tokens.error as Error).message)}
        onClose={() => void tokens.refetch()}
      />
    );
  }

  const items = tokens.data?.items ?? [];
  const isEmpty = items.length === 0;

  return (
    <div>
      <PageAction>
        <Button onClick={() => setCreateOpen(true)}>{t('page.create')}</Button>
      </PageAction>
      {isEmpty ? (
        <EmptyKeys onCreate={() => setCreateOpen(true)} />
      ) : (
        <KeysTable
          items={items}
          onEdit={(tok) => setEditTarget(tok)}
          onDelete={(tok) => setDeleteTarget(tok)}
          onToggleStatus={(tok) =>
            toggle.mutate({
              id: tok.id,
              nextStatus: tok.status === 1 ? 2 : 1,
            })
          }
        />
      )}
      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <EditTokenSheet
          open
          token={editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          open
          name={deleteTarget.name}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('delete.confirm') + ' ✓'),
              onError: (err) => toast.error((err as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
