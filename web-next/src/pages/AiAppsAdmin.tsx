import { type ChangeEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  FileImage,
  Globe2,
  Hash,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Rocket,
  Tags,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
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
  uploadAiAppImage,
  useAdminApps,
  useCreateAiApp,
  useDeleteAiApp,
  useUpdateAiApp,
  useUpdateAiAppStatus,
  type AiApp,
  type AiAppInput,
} from '@/hooks/useAiApps';

const PAGE_SIZE = 20;
const PLATFORM_ROLE_ROOT = 100;

const EMPTY: AiAppInput = {
  name: '',
  slug: '',
  description: '',
  icon_url: '',
  target_url: '',
  scope: 'tenant',
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
    scope: r.scope,
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

function parseTags(tags: string) {
  return tags
    .split(/[,\uFF0C]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getInitial(name: string) {
  return (name.trim().slice(0, 1) || 'A').toUpperCase();
}

const posterPalettes = [
  ['#0f766e', '#0ea5e9', '#111827'],
  ['#b45309', '#ef4444', '#1f2937'],
  ['#15803d', '#84cc16', '#172554'],
  ['#be123c', '#f97316', '#0f172a'],
  ['#0369a1', '#22c55e', '#312e81'],
  ['#7c2d12', '#eab308', '#1e293b'],
] as const;

function posterStyle(seed: string): CSSProperties {
  const index =
    seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % posterPalettes.length;
  const [from, via, to] = posterPalettes[index];
  return {
    background: `linear-gradient(135deg, ${from} 0%, ${via} 48%, ${to} 100%)`,
  };
}

function AppPoster({
  name,
  slug,
  imageUrl,
  className = '',
}: {
  name: string;
  slug: string;
  imageUrl: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = useMemo(() => posterStyle(`${slug}:${name}`), [name, slug]);

  if (imageUrl && !failed) {
    return (
      <div className={`relative overflow-hidden bg-bg-2 ${className}`}>
        <img
          src={imageUrl}
          alt={name}
          className='h-full w-full object-cover'
          onError={() => setFailed(true)}
        />
        <div className='absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent' />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden text-white ${className}`} style={style}>
      <div className='absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/16' />
      <div className='absolute bottom-4 right-5 h-14 w-14 rotate-12 rounded-lg bg-white/12' />
      <div className='absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-md bg-white/18 backdrop-blur'>
        <ImageIcon className='h-5 w-5' />
      </div>
      <div className='absolute bottom-4 left-4 right-4'>
        <div className='mb-2 text-32 font-semibold leading-none'>{getInitial(name)}</div>
        <div className='truncate text-13 font-medium text-white/90'>{name || slug}</div>
      </div>
    </div>
  );
}

function MetricItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string | number;
}) {
  return (
    <div className='min-w-0 rounded-md bg-bg-1 px-2.5 py-2'>
      <div className='flex items-center gap-1.5 text-11 text-fg-2'>
        <Icon className='h-3.5 w-3.5' />
        <span className='truncate'>{label}</span>
      </div>
      <div className='mt-1 truncate text-13 font-medium text-fg-0'>{value}</div>
    </div>
  );
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
  const { user } = useAuth();
  const isPlatformRoot = (user?.platform_role ?? 0) >= PLATFORM_ROLE_ROOT;
  const create = useCreateAiApp();
  const update = useUpdateAiApp();
  const isEdit = Boolean(record);
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const posterInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<AiAppInput>({
    defaultValues: record ? fromRecord(record) : EMPTY,
  });

  const posterUrl = form.watch('icon_url');
  const appName = form.watch('name');
  const appSlug = form.watch('slug');

  useEffect(() => {
    form.reset(record ? fromRecord(record) : EMPTY);
  }, [record, form]);

  async function onPosterChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('form.poster_file_error'));
      return;
    }
    try {
      setUploadingPoster(true);
      const url = await uploadAiAppImage(file);
      form.setValue('icon_url', url, { shouldDirty: true, shouldValidate: true });
      toast.success(t('form.poster_upload_success'));
    } catch {
      toast.error(t('form.poster_upload_error'));
    } finally {
      setUploadingPoster(false);
    }
  }

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
          <DialogTitle>{isEdit ? t('form.title.edit') : t('form.title.create')}</DialogTitle>
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
          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-3'>
              <div className='space-y-1'>
                <Label>{t('form.poster')}</Label>
                <p className='text-12 text-fg-2'>{t('form.poster_help')}</p>
              </div>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                disabled={uploadingPoster}
                onClick={() => posterInputRef.current?.click()}
              >
                {uploadingPoster ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Upload className='h-4 w-4' />
                )}
                {uploadingPoster
                  ? t('form.poster_uploading')
                  : posterUrl
                    ? t('form.poster_replace')
                    : t('form.poster_upload')}
              </Button>
              <input
                ref={posterInputRef}
                id='app-poster-upload'
                type='file'
                accept='image/*'
                className='hidden'
                onChange={(event) => void onPosterChange(event)}
              />
            </div>
            <AppPoster
              name={appName || t('form.name')}
              slug={appSlug || 'new-app'}
              imageUrl={posterUrl}
              className='aspect-[16/9] w-full rounded-md'
            />
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
            <Input
              id='app-tags'
              placeholder={t('form.tags_placeholder')}
              {...form.register('tags')}
            />
          </div>
          {(isPlatformRoot || isEdit) && (
            <div className='space-y-1.5'>
              <Label>{t('form.scope')}</Label>
              <Select
                value={form.watch('scope')}
                onValueChange={(v) => form.setValue('scope', v as 'platform' | 'tenant')}
                disabled={isEdit || !isPlatformRoot}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='tenant'>{t('form.scope.tenant')}</SelectItem>
                  <SelectItem value='platform' disabled={!isPlatformRoot}>
                    {t('form.scope.platform')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className='text-12 text-fg-2'>
                {isEdit ? t('form.scope.locked') : t('form.scope.help')}
              </p>
            </div>
          )}
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

function AdminAppCard({
  app,
  t,
  onEdit,
  onToggleStatus,
  onDelete,
  isMutating,
}: {
  app: AiApp;
  t: (k: string) => string;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  isMutating: boolean;
}) {
  const tags = parseTags(app.tags);
  const isOnline = app.status === AI_APP_STATUS.ONLINE;

  return (
    <article className='group overflow-hidden rounded-lg border border-line bg-bg-0 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md'>
      <div className='relative'>
        <AppPoster
          name={app.name}
          slug={app.slug}
          imageUrl={app.icon_url}
          className='aspect-[16/9] w-full'
        />
        <div className='absolute left-3 top-3 flex flex-wrap gap-1.5'>
          <Badge variant={statusVariant(app.status)} className='shadow-sm'>
            {statusLabel(app.status, t)}
          </Badge>
          <Badge variant={app.scope === 'platform' ? 'default' : 'secondary'} className='shadow-sm'>
            {t(`scope.${app.scope}`)}
          </Badge>
        </div>
      </div>

      <div className='space-y-3 p-3.5'>
        <div className='min-w-0'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <h3 className='truncate text-16 font-semibold leading-6'>{app.name}</h3>
              <div className='mt-1 flex min-w-0 items-center gap-1.5 text-12 text-fg-2'>
                <Globe2 className='h-3.5 w-3.5 shrink-0' />
                <span className='truncate font-mono'>{app.slug}</span>
              </div>
            </div>
          </div>
          <p className='mt-2 min-h-[40px] text-13 leading-5 text-fg-2 line-clamp-2'>
            {app.description || t('no_description')}
          </p>
        </div>

        <div className='flex min-h-6 flex-wrap gap-1.5'>
          {tags.length > 0 ? (
            <>
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant='secondary' className='h-6 px-2 text-11'>
                  {tag}
                </Badge>
              ))}
              {tags.length > 3 && (
                <Badge variant='secondary' className='h-6 px-2 text-11'>
                  +{tags.length - 3}
                </Badge>
              )}
            </>
          ) : (
            <span className='inline-flex items-center gap-1.5 text-12 text-fg-2'>
              <Tags className='h-3.5 w-3.5' />-
            </span>
          )}
        </div>

        <div className='grid grid-cols-3 gap-2'>
          <MetricItem icon={Hash} label='ID' value={app.id} />
          <MetricItem icon={Rocket} label={t('col.sort')} value={app.sort_order} />
          <MetricItem
            icon={Users}
            label={t('col.guest_quota')}
            value={app.guest_quota > 0 ? app.guest_quota : '-'}
          />
        </div>

        <div className='grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4'>
          <Button size='sm' variant='secondary' onClick={onEdit}>
            <Pencil className='h-4 w-4' />
            {t('action.edit')}
          </Button>
          <Button
            size='sm'
            variant={isOnline ? 'secondary' : 'default'}
            disabled={isMutating}
            onClick={onToggleStatus}
          >
            <Rocket className='h-4 w-4' />
            {isOnline ? t('action.unpublish') : t('action.publish')}
          </Button>
          <Button size='sm' variant='ghost' asChild>
            <a href={app.target_url} target='_blank' rel='noreferrer'>
              <ExternalLink className='h-4 w-4' />
              {t('preview')}
            </a>
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='text-danger hover:text-danger'
            onClick={onDelete}
          >
            <Trash2 className='h-4 w-4' />
            {t('action.delete')}
          </Button>
        </div>
      </div>
    </article>
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
    const next = app.status === AI_APP_STATUS.ONLINE ? AI_APP_STATUS.DRAFT : AI_APP_STATUS.ONLINE;
    try {
      await statusMut.mutateAsync({ id: app.id, status: next });
      toast.success(next === AI_APP_STATUS.ONLINE ? t('toast.published') : t('toast.unpublished'));
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
        <div className='grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-[360px] w-full rounded-lg' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-line bg-bg-1 p-8 text-center'>
          <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-md bg-bg-2 text-fg-2'>
            <FileImage className='h-6 w-6' />
          </div>
          <div className='text-14 font-medium text-fg-0'>{t('empty')}</div>
        </div>
      ) : (
        <>
          <div className='grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3'>
            {items.map((app) => (
              <AdminAppCard
                key={app.id}
                app={app}
                t={t}
                isMutating={statusMut.isPending}
                onEdit={() => setFormTarget(app)}
                onToggleStatus={() => void toggleStatus(app)}
                onDelete={() => setDeleteTarget(app)}
              />
            ))}
          </div>
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
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
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
        isPending={deleteMut.isPending}
      />
    </div>
  );
}
