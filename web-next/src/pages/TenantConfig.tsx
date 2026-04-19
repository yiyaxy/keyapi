import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteTenantConfig,
  useSetTenantConfig,
  useTenantConfig,
  type TenantConfigItem,
} from '@/hooks/useTenantConfig';

export function TenantConfigPage() {
  const { t } = useTranslation('tenant');
  const config = useTenantConfig();
  const setOverride = useSetTenantConfig();
  const deleteOverride = useDeleteTenantConfig();
  const [editing, setEditing] = useState<TenantConfigItem | null>(null);
  const [draft, setDraft] = useState('');

  const items = config.data ?? [];

  function openEdit(item: TenantConfigItem) {
    setEditing(item);
    setDraft(item.value);
  }

  async function save() {
    if (!editing) return;
    try {
      await setOverride.mutateAsync({ key: editing.key, value: draft });
      toast.success(t('config.edit.success'));
      setEditing(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function reset(item: TenantConfigItem) {
    deleteOverride.mutate(item.key, {
      onSuccess: () => toast.success(t('config.reset.success')),
      onError: (e) => toast.error((e as Error).message),
    });
  }

  return (
    <div className='max-w-5xl space-y-4'>
      <header>
        <h1 className='text-20 font-semibold'>{t('config.title')}</h1>
        <p className='mt-1 text-13 text-fg-2'>{t('config.sub')}</p>
      </header>
      {config.isError && (
        <InlineBanner
          level='danger'
          message={String((config.error as Error).message)}
          onClose={() => void config.refetch()}
        />
      )}
      {config.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('config.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('config.col.key')}</th>
                <th className='px-3 py-2 font-medium'>{t('config.col.value')}</th>
                <th className='px-3 py-2 font-medium'>{t('config.col.source')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {items
                .slice()
                .sort((a, b) => a.key.localeCompare(b.key))
                .map((item) => (
                  <tr
                    key={item.key}
                    className='border-b border-line text-13 hover:bg-bg-1'
                  >
                    <td className='px-3 py-2 font-mono text-12'>{item.key}</td>
                    <td className='max-w-[400px] px-3 py-2 font-mono text-12'>
                      <div className='truncate'>{item.value || <span className='text-fg-2'>—</span>}</div>
                    </td>
                    <td className='px-3 py-2'>
                      <Badge variant={item.overridden ? 'default' : 'outline'}>
                        {t(
                          item.overridden
                            ? 'config.source.override'
                            : 'config.source.platform'
                        )}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => openEdit(item)}
                        >
                          {t('config.action.edit')}
                        </Button>
                        {item.overridden && (
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='text-danger'
                            onClick={() => reset(item)}
                            disabled={deleteOverride.isPending}
                          >
                            {t('config.action.reset')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <DialogContent className='max-w-[520px]'>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle className='font-mono text-15'>
                  {t('config.edit.title', { key: editing.key })}
                </DialogTitle>
              </DialogHeader>
              <div className='space-y-3'>
                <div className='space-y-2'>
                  <Label htmlFor='cfg-value'>{t('config.edit.value')}</Label>
                  <Textarea
                    id='cfg-value'
                    rows={6}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className='font-mono text-12'
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => setEditing(null)}
                >
                  {t('config.edit.cancel')}
                </Button>
                <Button
                  type='button'
                  onClick={() => void save()}
                  disabled={setOverride.isPending}
                >
                  {t('config.edit.save')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
