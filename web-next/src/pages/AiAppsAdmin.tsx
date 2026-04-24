import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PageAction } from '@/hooks/usePageAction';
import {
  AI_APP_STATUS,
  useAdminApps,
  useCreateAiApp,
  useDeleteAiApp,
  useUpdateAiApp,
  useUpdateAiAppStatus,
  type AiApp,
  type AiAppInput,
} from '@/hooks/useAiApps';

const PAGE_SIZE = 20;

const EMPTY: AiAppInput = {
  name: '',
  slug: '',
  description: '',
  icon_url: '',
  target_url: '',
  status: AI_APP_STATUS.DRAFT,
  sort_order: 0,
  vendor_user_id: 0,
  guest_quota: 0,
  default_group: '',
  session_token_ttl: 86400,
  tags: '',
};

function fromRecord(r: AiApp): AiAppInput {
  return {
    name: r.name,
    slug: r.slug,
    description: r.description,
    icon_url: r.icon_url,
    target_url: r.target_url,
    status: r.status,
    sort_order: r.sort_order,
    vendor_user_id: r.vendor_user_id,
    guest_quota: r.guest_quota,
    default_group: r.default_group,
    session_token_ttl: r.session_token_ttl,
    tags: r.tags,
  };
}

function statusLabel(status: number, t: (k: string) => string): string {
  switch (status) {
    case AI_APP_STATUS.ONLINE:
      return t('status.online');
    case AI_APP_STATUS.ARCHIVED:
      return t('status.archived');
    default:
      return t('status.draft');
  }
}

function statusVariant(status: number): 'default' | 'secondary' | 'destructive' {
  switch (status) {
    case AI_APP_STATUS.ONLINE:
      return 'default';
    case AI_APP_STATUS.ARCHIVED:
      return 'destructive';
    default:
      return 'secondary';
  }
}

function AppFormDialog({
  open,
  record,
  onOpenChange,
}: {
  open: boolean;
  record: AiApp | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('apps');
  const create = useCreateAiApp();
  const update = useUpdateAiApp();
  const isEdit = Boolean(record);

  const form = useForm<AiAppInput>({
    defaultValues: record ? fromRecord(record) : EMPTY,
  });

  useEffect(() => {
    form.reset(record ? fromRecord(record) : EMPTY);
  }, [record, form]);

  async function onSubmit(values: AiAppInput) {
    try {
      if (record) {
        await update.mutateAsync({ ...values, id: record.id });
        toast.success(t('toast.update.success'));
      } else {
        await create.mutateAsync(values);
        toast.success(t('toast.create.success'));
      }
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  const mutation = isEdit ? update : create;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('form.title.edit') : t('form.title.create')}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className='max-h-[70vh] space-y-3 overflow-y-auto pr-1'
        >
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='app-name'>{t('form.name')}</Label>
              <Input id='app-name' {...form.register('name')} />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='app-slug'>{t('form.slug')}</Label>
              <Input id='app-slug' {...form.register('slug')} />
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='app-target'>{t('form.target_url')}</Label>
            <Input id='app-target' placeholder='https://...' {...form.register('target_url')} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='app-icon'>{t('form.icon_url')}</Label>
            <Input id='app-icon' placeholder='https://...' {...form.register('icon_url')} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='app-desc'>{t('form.description')}</Label>
            <Textarea id='app-desc' rows={3} {...form.register('description')} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='app-tags'>{t('form.tags')}</Label>
            <Input id='app-tags' placeholder={t('form.tags_placeholder')} {...form.register('tags')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label>{t('form.status')}</Label>
              <Select
                value={String(form.watch('status'))}
                onValueChange={(v) => form.setValue('status', Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='0'>{t('status.draft')}</SelectItem>
                  <SelectItem value='1'>{t('status.online')}</SelectItem>
                  <SelectItem value='2'>{t('status.archived')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='app-sort'>{t('form.sort_order')}</Label>
              <Input
                id='app-sort'
                type='number'
                {...form.register('sort_order', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='app-guest'>{t('form.guest_quota')}</Label>
              <Input
                id='app-guest'
                type='number'
                min={0}
                {...form.register('guest_quota', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.guest_quota_help')}</p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='app-ttl'>{t('form.session_ttl')}</Label>
              <Input
                id='app-ttl'
                type='number'
                min={60}
                {...form.register('session_token_ttl', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.session_ttl_help')}</p>
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='app-group'>{t('form.default_group')}</Label>
              <Input id='app-group' {...form.register('default_group')} />
              <p className='text-12 text-fg-2'>{t('form.default_group_help')}</p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='app-vendor'>{t('form.vendor_user_id')}</Label>
              <Input
                id='app-vendor'
                type='number'
                min={0}
                {...form.register('vendor_user_id', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.vendor_user_id_help')}</p>
            </div>
          </div>
          <DialogFooter className='pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('form.cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {t('form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AiAppsAdminPage() {
  const { t } = useTranslation('apps');
  const [page, setPage] = useState(1);
  const [formTarget, setFormTarget] = useState<AiApp | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiApp | null>(null);

  const list = useAdminApps({ p: page, page_size: PAGE_SIZE });
  const statusMut = useUpdateAiAppStatus();
  const deleteMut = useDeleteAiApp();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  async function toggleStatus(app: AiApp) {
    const next =
      app.status === AI_APP_STATUS.ONLINE ? AI_APP_STATUS.DRAFT : AI_APP_STATUS.ONLINE;
    try {
      await statusMut.mutateAsync({ id: app.id, status: next });
      toast.success(
        next === AI_APP_STATUS.ONLINE ? t('toast.published') : t('toast.unpublished')
      );
    } catch {
      /* banner */
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success(t('toast.delete.success'));
      setDeleteTarget(null);
    } catch {
      /* banner */
    }
  }

  return (
    <div className='space-y-4'>
      <PageAction>
        <Button onClick={() => setFormTarget('new')}>{t('action.create')}</Button>
      </PageAction>

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
                  <th className='px-3 py-2 font-medium'>ID</th>
                  <th className='px-3 py-2 font-medium'>{t('col.name')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.slug')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.status')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.tags')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.guest_quota')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.sort')}</th>
                  <th className='px-3 py-2 font-medium'>{t('col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((app) => (
                  <tr
                    key={app.id}
                    className='border-b border-line last:border-0 hover:bg-bg-1'
                  >
                    <td className='px-3 py-2 text-fg-2'>{app.id}</td>
                    <td className='px-3 py-2 font-medium'>{app.name}</td>
                    <td className='px-3 py-2 text-fg-2 font-mono text-12'>{app.slug}</td>
                    <td className='px-3 py-2'>
                      <Badge variant={statusVariant(app.status)}>
                        {statusLabel(app.status, t)}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-fg-2 text-12'>{app.tags || '—'}</td>
                    <td className='px-3 py-2 text-fg-2'>
                      {app.guest_quota > 0 ? app.guest_quota : '—'}
                    </td>
                    <td className='px-3 py-2 text-fg-2'>{app.sort_order}</td>
                    <td className='px-3 py-2'>
                      <div className='flex items-center gap-1'>
                        <Button
                          size='sm'
                          variant='secondary'
                          onClick={() => setFormTarget(app)}
                        >
                          {t('action.edit')}
                        </Button>
                        <Button
                          size='sm'
                          variant={
                            app.status === AI_APP_STATUS.ONLINE ? 'secondary' : 'default'
                          }
                          onClick={() => toggleStatus(app)}
                        >
                          {app.status === AI_APP_STATUS.ONLINE
                            ? t('action.unpublish')
                            : t('action.publish')}
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          onClick={() => setDeleteTarget(app)}
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
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
        </>
      )}

      <AppFormDialog
        open={formTarget !== null}
        record={formTarget !== 'new' ? (formTarget as AiApp | null) : null}
        onOpenChange={(o) => {
          if (!o) setFormTarget(null);
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('confirm.delete.title')}
        body={t('confirm.delete.body', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('action.delete')}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        isPending={deleteMut.isPending}
      />
    </div>
  );
}
