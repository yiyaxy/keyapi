import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
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
import { Textarea } from '@/components/ui/textarea';
import { useCreateRedemptions } from '@/hooks/useRedemptions';
import { ApiError } from '@/lib/api';

const QUOTA_PER_UNIT = 500_000;

const schema = z.object({
  name: z.string().min(1).max(20),
  usd: z.number().positive().max(10_000),
  count: z.number().int().min(1).max(100),
  expires_days: z.number().int().min(0),
});
type Values = z.infer<typeof schema>;

export function CreateRedemptionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('redemption');
  const create = useCreateRedemptions();
  const [generated, setGenerated] = useState<string[] | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', usd: 10, count: 1, expires_days: 0 },
  });

  async function onSubmit(values: Values) {
    // eslint-disable-next-line react-hooks/purity
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = values.expires_days > 0 ? nowSec + values.expires_days * 86400 : 0;
    try {
      const keys = await create.mutateAsync({
        name: values.name,
        quota: Math.round(values.usd * QUOTA_PER_UNIT),
        count: values.count,
        expired_time: expired,
      });
      setGenerated(keys ?? []);
    } catch {
      /* banner */
    }
  }

  async function copyAll() {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.join('\n'));
    toast.success(t('action.copied'));
  }

  function closeDialog(o: boolean) {
    if (!o) {
      setGenerated(null);
      form.reset({ name: '', usd: 10, count: 1, expires_days: 0 });
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className='max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>
            {generated
              ? t('create.result.title', { count: generated.length })
              : t('create.title')}
          </DialogTitle>
        </DialogHeader>
        {create.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={create.error.backendMessage ?? create.error.message}
          />
        )}
        {generated ? (
          <>
            <Textarea rows={8} readOnly value={generated.join('\n')} />
            <DialogFooter>
              <Button variant='secondary' onClick={() => closeDialog(false)}>
                {t('create.result.close')}
              </Button>
              <Button onClick={copyAll}>{t('create.result.copy_all')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='cr-name'>{t('create.name')}</Label>
              <Input id='cr-name' autoFocus {...form.register('name')} />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='cr-usd'>{t('create.quota')}</Label>
                <Input
                  id='cr-usd'
                  type='number'
                  min={0.01}
                  step={0.01}
                  {...form.register('usd', { valueAsNumber: true })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='cr-count'>{t('create.count')}</Label>
                <Input
                  id='cr-count'
                  type='number'
                  min={1}
                  max={100}
                  {...form.register('count', { valueAsNumber: true })}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant='secondary'
                  size='sm'
                  onClick={() => form.setValue('expires_days', 0)}
                >
                  {t('create.expires_never')}
                </Button>
                <Button
                  type='button'
                  variant='secondary'
                  size='sm'
                  onClick={() => form.setValue('expires_days', 30)}
                >
                  {t('create.expires_30d')}
                </Button>
                <Button
                  type='button'
                  variant='secondary'
                  size='sm'
                  onClick={() => form.setValue('expires_days', 90)}
                >
                  {t('create.expires_90d')}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='secondary'
                onClick={() => closeDialog(false)}
              >
                {t('create.cancel')}
              </Button>
              <Button type='submit' disabled={create.isPending}>
                {t('create.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
