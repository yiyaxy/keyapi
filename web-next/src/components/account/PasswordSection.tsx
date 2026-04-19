import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateSelf } from '@/hooks/useUpdateSelf';
import { ApiError } from '@/lib/api';

export function PasswordSection({ username }: { username: string }) {
  const { t } = useTranslation('account');
  const update = useUpdateSelf();

  const schema = z
    .object({
      current: z.string().min(1),
      next: z.string().min(8, t('password.too_short')),
      confirm: z.string(),
    })
    .refine((v) => v.next === v.confirm, {
      message: t('password.mismatch'),
      path: ['confirm'],
    })
    .refine((v) => v.next !== v.current, {
      message: t('password.same'),
      path: ['next'],
    });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  async function onSubmit(values: Values) {
    try {
      await update.mutateAsync({
        username,
        password: values.next,
        original_password: values.current,
      });
      toast.success(t('password.updated'));
      form.reset();
    } catch {
      /* banner below */
    }
  }

  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('password.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
            className='mb-4'
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='pw-current'>{t('password.current')}</Label>
            <Input id='pw-current' type='password' {...form.register('current')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pw-next'>{t('password.next')}</Label>
            <Input id='pw-next' type='password' {...form.register('next')} />
            {errors.next && <div className='text-12 text-danger'>{errors.next.message}</div>}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pw-confirm'>{t('password.confirm')}</Label>
            <Input id='pw-confirm' type='password' {...form.register('confirm')} />
            {errors.confirm && <div className='text-12 text-danger'>{errors.confirm.message}</div>}
          </div>
          <div className='flex justify-end'>
            <Button type='submit' disabled={update.isPending}>
              {t('password.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
