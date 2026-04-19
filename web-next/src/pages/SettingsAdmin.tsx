import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useForceLogoutAll,
  useOptions,
  useUpdateOption,
  type Option,
} from '@/hooks/useOptions';

function detectBool(value: string): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function EditDialogInner({
  option,
  onOpenChange,
}: {
  option: Option;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const update = useUpdateOption();
  const [value, setValue] = useState(option.value);
  const [boolValue, setBoolValue] = useState<boolean | null>(
    detectBool(option.value)
  );

  const isBool = boolValue !== null;

  function submit() {
    const payload = isBool ? boolValue! : value;
    update.mutate(
      { key: option.key, value: payload },
      {
        onSuccess: () => {
          toast.success(t('toast.save.success'));
          onOpenChange(false);
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[640px]'>
        <DialogHeader>
          <DialogTitle className='font-mono text-14'>
            {t('form.title', { key: option.key })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='opt-value'>{t('form.value.label')}</Label>
          {isBool ? (
            <div className='flex items-center gap-2'>
              <Switch
                id='opt-value'
                checked={boolValue!}
                onCheckedChange={setBoolValue}
              />
              <span className='text-13'>
                {boolValue ? t('form.bool.true') : t('form.bool.false')}
              </span>
            </div>
          ) : value.length > 80 || value.includes('\n') ? (
            <Textarea
              id='opt-value'
              rows={10}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className='font-mono text-12'
            />
          ) : (
            <Input
              id='opt-value'
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className='font-mono'
            />
          )}
        </div>
        <DialogFooter>
          <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button type='button' disabled={update.isPending} onClick={submit}>
            {t('form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsAdminPage() {
  const { t } = useTranslation('settings');
  const list = useOptions();
  const forceLogout = useForceLogoutAll();
  const [keyword, setKeyword] = useState('');
  const [editTarget, setEditTarget] = useState<Option | null>(null);
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false);

  const filtered = useMemo(() => {
    const items = list.data ?? [];
    if (!keyword) return items;
    const k = keyword.toLowerCase();
    return items.filter(
      (o) => o.key.toLowerCase().includes(k) || o.value.toLowerCase().includes(k)
    );
  }, [list.data, keyword]);

  return (
    <div className='space-y-4'>
      <InlineBanner level='info' message={t('notice')} />
      <div className='flex items-center gap-2'>
        <Input
          className='max-w-xs'
          placeholder={t('search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className='ml-auto'>
          <Button
            type='button'
            variant='secondary'
            className='text-danger'
            onClick={() => setForceLogoutOpen(true)}
          >
            {t('action.force_logout')}
          </Button>
        </div>
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
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('col.key')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.value')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.key} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='max-w-[260px] px-3 py-2 font-mono text-12'>
                    {o.key}
                  </td>
                  <td className='max-w-[480px] truncate px-3 py-2 font-mono text-12 text-fg-1'>
                    {o.value}
                  </td>
                  <td className='px-3 py-2'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => setEditTarget(o)}
                    >
                      {t('action.edit')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editTarget && (
        <EditDialogInner
          key={editTarget.key}
          option={editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
        />
      )}
      <ConfirmDialog
        open={forceLogoutOpen}
        title={t('force_logout.title')}
        body={t('force_logout.body')}
        confirmLabel={t('force_logout.confirm')}
        isPending={forceLogout.isPending}
        onOpenChange={setForceLogoutOpen}
        onConfirm={() => {
          setForceLogoutOpen(false);
          forceLogout.mutate(undefined, {
            onSuccess: () => toast.success(t('toast.force_logout.success')),
            onError: (e) => toast.error((e as Error).message),
          });
        }}
      />
    </div>
  );
}
