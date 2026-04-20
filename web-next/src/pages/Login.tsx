import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { PasswordField } from '@/components/auth/PasswordField';
import { WechatQrModal } from '@/components/auth/WechatQrModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1, 'required'),
  password: z.string().min(1, 'required'),
});
type Values = z.infer<typeof schema>;

export function Login() {
  const { t } = useTranslation('auth');
  const { login, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [wechatOpen, setWechatOpen] = useState(false);
  const redirect = params.get('redirect') || '/';

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    form.setFocus('username');
  }, [form]);

  if (status === 'authenticated') {
    return <Navigate to={redirect} replace />;
  }

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await login(values);
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.backendMessage ?? err.message);
      } else {
        setError(String(err));
      }
    }
  }

  return (
    <AuthLayout
      eyebrow={t('login.eyebrow')}
      title={t('login.title')}
      footer={
        <>
          {t('login.to_register').replace('→', '')}
          <Link to='/register' className='ml-1 text-accent hover:underline'>
            {'→'}
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='username'>{t('login.username_label')}</Label>
          <Input id='username' autoComplete='username' {...form.register('username')} />
        </div>
        <div className='space-y-2'>
          <div className='flex items-baseline justify-between'>
            <Label htmlFor='password'>{t('login.password_label')}</Label>
            <Link to='/forgot' className='text-13 text-accent hover:underline'>
              {t('login.forgot')}
            </Link>
          </div>
          <PasswordField
            id='password'
            autoComplete='current-password'
            {...form.register('password')}
          />
        </div>
        {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
        <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('login.submit_loading') : t('login.submit')}
        </Button>
      </form>
      <div className='my-6 flex items-center gap-3'>
        <Separator className='flex-1' />
        <span className='text-13 text-fg-2'>{t('login.or')}</span>
        <Separator className='flex-1' />
      </div>
      <Button
        type='button'
        variant='secondary'
        className='w-full'
        onClick={() => setWechatOpen(true)}
      >
        {t('login.wechat')}
      </Button>
      <WechatQrModal open={wechatOpen} onOpenChange={setWechatOpen} redirectTo={redirect} />
    </AuthLayout>
  );
}
