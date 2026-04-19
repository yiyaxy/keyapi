import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateUser, type AdminUser } from '@/hooks/useUsers';
import { ApiError } from '@/lib/api';

const schema = z.object({
  display_name: z.string().max(20),
  email: z.string().email().or(z.literal('')),
  group: z.string().max(64),
  quota: z.number().int().min(0),
  password: z.string().max(20),
});
type Values = z.infer<typeof schema>;

export function EditUserDialog({
  open,
  user,
  onOpenChange,
}: {
  open: boolean;
  user: AdminUser;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('users');
  const update = useUpdateUser();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      quota: user.quota,
      password: '',
    },
  });

  useEffect(() => {
    form.reset({
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      quota: user.quota,
      password: '',
    });
  }, [user, form]);

  async function onSubmit(values: Values) {
    try {
      const payload: Parameters<typeof update.mutateAsync>[0] = {
        id: user.id,
        username: user.username,
        display_name: values.display_name,
        email: values.email,
        group: values.group,
        quota: values.quota,
      };
      if (values.password.trim()) payload.password = values.password.trim();
      await update.mutateAsync(payload);
      toast.success(t('edit.success'));
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
        </DialogHeader>
        {update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='eu-display'>{t('edit.display_name')}</Label>
            <Input id='eu-display' {...form.register('display_name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-email'>{t('edit.email')}</Label>
            <Input id='eu-email' type='email' {...form.register('email')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-group'>{t('edit.group')}</Label>
            <Input id='eu-group' {...form.register('group')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-quota'>{t('edit.quota')}</Label>
            <Input
              id='eu-quota'
              type='number'
              min={0}
              {...form.register('quota', { valueAsNumber: true })}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-password'>{t('edit.password')}</Label>
            <Input id='eu-password' type='password' {...form.register('password')} />
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('create.cancel')}
            </Button>
            <Button type='submit' disabled={update.isPending}>
              {t('edit.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
