import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenantInfo, useUpdateTenant } from '@/hooks/useTenant';
import { ApiError } from '@/lib/api';
import { fmtDateSec } from '@/lib/format';

const schema = z.object({
  name: z.string().min(1).max(128),
});
type Values = z.infer<typeof schema>;

export function TenantInfoPage() {
  const { t } = useTranslation('tenant');
  const info = useTenantInfo();
  const update = useUpdateTenant();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (info.data) form.reset({ name: info.data.name });
  }, [info.data, form]);

  if (info.isPending) {
    return <Skeleton className='h-48 w-full' />;
  }
  if (info.isError || !info.data) {
    return (
      <InlineBanner
        level='danger'
        message={String((info.error as Error).message)}
        onClose={() => void info.refetch()}
      />
    );
  }

  const tenant = info.data;

  async function onSubmit(values: Values) {
    try {
      await update.mutateAsync({ name: values.name });
      toast.success(t('info.saved'));
    } catch {
      /* banner */
    }
  }

  return (
    <div className='max-w-2xl space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('info.section')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {update.error instanceof ApiError && (
            <InlineBanner
              level='danger'
              message={update.error.backendMessage ?? update.error.message}
            />
          )}
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='tenant-name'>{t('info.name')}</Label>
              <Input id='tenant-name' {...form.register('name')} />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-1'>
                <Label className='text-fg-2'>{t('info.slug')}</Label>
                <div className='font-mono text-13 text-fg-1'>{tenant.slug}</div>
                <div className='text-12 text-fg-2'>{t('info.slug.readonly')}</div>
              </div>
              <div className='space-y-1'>
                <Label className='text-fg-2'>{t('info.status')}</Label>
                <div className='text-13 text-fg-1'>
                  {tenant.status === 1
                    ? t('info.status.active')
                    : t('info.status.suspended')}
                </div>
              </div>
              <div className='space-y-1'>
                <Label className='text-fg-2'>{t('info.created')}</Label>
                <div className='text-13 text-fg-1'>{fmtDateSec(tenant.created_at)}</div>
              </div>
            </div>
            <div className='flex justify-end'>
              <Button type='submit' disabled={update.isPending || !form.formState.isDirty}>
                {t('info.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
