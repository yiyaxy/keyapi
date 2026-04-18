import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { ResendCountdown } from '@/components/auth/ResendCountdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';

const schema = z.object({ email: z.string().email() });
type Values = z.infer<typeof schema>;

export function Forgot() {
  const { t } = useTranslation('auth');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function send(target: string) {
    await api.get('/api/reset_password', { params: { email: target } });
  }

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await send(values.email);
      setSentTo(values.email);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('forgot.eyebrow')}
      title={sentTo ? t('forgot.sent_title') : t('forgot.title')}
      footer={
        <Link to='/login' className='text-accent hover:underline'>
          {t('forgot.back_to_login')}
        </Link>
      }
    >
      {sentTo ? (
        <div className='space-y-4'>
          <p className='text-13 text-fg-1'>{t('forgot.sent_body', { email: sentTo })}</p>
          <ResendCountdown onResend={() => send(sentTo)} initialSeconds={60} />
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='email'>{t('forgot.email_label')}</Label>
            <Input
              id='email'
              type='email'
              autoFocus
              autoComplete='email'
              {...form.register('email')}
            />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('forgot.sending') : t('forgot.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
