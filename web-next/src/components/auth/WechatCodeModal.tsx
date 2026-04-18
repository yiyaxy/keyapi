import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { saveBootstrap } from '@/lib/bootstrap';

import { InlineBanner } from './InlineBanner';

const schema = z.object({ code: z.string().min(1, 'required') });
type Values = z.infer<typeof schema>;

export function WechatCodeModal({
  open,
  onOpenChange,
  redirectTo = '/',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  redirectTo?: string;
}) {
  const { t } = useTranslation('auth');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      const res = await api.get<{ id: number; tenant_id: number }>('/api/oauth/wechat', {
        params: { code: values.code },
      });
      saveBootstrap({ id: res.data.id, tenant_id: res.data.tenant_id ?? 1 });
      await refresh();
      onOpenChange(false);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.backendMessage ?? err.message);
      } else {
        setError('Unknown error');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[360px]'>
        <DialogHeader>
          <DialogTitle>{t('wechat.modal_title')}</DialogTitle>
          <DialogDescription>{t('wechat.explain')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='wechat-code'>{t('wechat.code_label')}</Label>
            <Input
              id='wechat-code'
              autoFocus
              autoComplete='one-time-code'
              {...form.register('code')}
            />
          </div>
          {error && (
            <InlineBanner level='danger' message={error} onClose={() => setError(null)} />
          )}
          <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('wechat.submitting') : t('wechat.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
