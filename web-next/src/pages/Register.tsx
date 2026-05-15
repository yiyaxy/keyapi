import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordStrengthBar } from '@/components/auth/PasswordStrengthBar';
import { ResendCountdown } from '@/components/auth/ResendCountdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { ApiError, api } from '@/lib/api';

const emailSchema = z.object({
  email: z.string().trim().email('invalid email'),
});

const accountSchema = z
  .object({
    username: z.string().trim().max(20, 'username too long').optional(),
    verification_code: z.string().trim().min(1, 'required'),
    password: z.string().min(8, 'password too short').max(20, 'password too long'),
    confirm_password: z.string().min(1, 'required'),
  })
  .refine((v) => v.password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'password mismatch',
  });

type EmailValues = z.infer<typeof emailSchema>;
type AccountValues = z.infer<typeof accountSchema>;

function usernameFromEmail(email: string): string {
  return (
    email
      .split('@')[0]
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 20) || 'user'
  );
}

export function Register() {
  const { t } = useTranslation('auth');
  const { register, status } = useAuth();
  const cfg = usePublicConfig();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const redirect = params.get('redirect') || '/';
  const canRegister = cfg.register_enabled !== false && cfg.password_register_enabled !== false;

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });
  const accountForm = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      username: '',
      verification_code: '',
      password: '',
      confirm_password: '',
    },
  });

  if (status === 'authenticated') {
    return <Navigate to={redirect} replace />;
  }

  async function sendCode(target = emailForm.getValues('email')) {
    setError(null);
    const parsed = emailSchema.safeParse({ email: target });
    if (!parsed.success) {
      emailForm.setError('email', { message: parsed.error.issues[0]?.message ?? 'invalid email' });
      return;
    }
    try {
      await api.get('/api/verification', { params: { email: parsed.data.email } });
      setEmail(parsed.data.email);
      accountForm.setValue('username', usernameFromEmail(parsed.data.email), {
        shouldDirty: false,
      });
      accountForm.setFocus('verification_code');
    } catch (err) {
      setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
    }
  }

  async function onEmailSubmit(values: EmailValues) {
    await sendCode(values.email);
  }

  async function onAccountSubmit(values: AccountValues) {
    setError(null);
    const aff = params.get('aff') || params.get('aff_code') || undefined;
    try {
      await register({
        username: values.username?.trim() || usernameFromEmail(email),
        email,
        password: values.password,
        verification_code: values.verification_code,
        aff_code: aff,
      });
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('register.eyebrow')}
      title={t('register.title')}
      footer={
        <Link
          to={`/login${params.toString() ? `?${params.toString()}` : ''}`}
          className='text-accent hover:underline'
        >
          {t('register.to_login')}
        </Link>
      }
    >
      {!canRegister ? (
        <InlineBanner level='info' message='当前租户暂未开放邮箱注册' />
      ) : !email ? (
        <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='email'>{t('register.step1.email_label')}</Label>
            <Input
              id='email'
              type='email'
              autoComplete='email'
              autoFocus
              {...emailForm.register('email')}
            />
            {emailForm.formState.errors.email && (
              <p className='text-12 text-danger'>{emailForm.formState.errors.email.message}</p>
            )}
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={emailForm.formState.isSubmitting}>
            {emailForm.formState.isSubmitting
              ? t('register.step1.sending')
              : t('register.step1.send_code')}
          </Button>
        </form>
      ) : (
        <form onSubmit={accountForm.handleSubmit(onAccountSubmit)} className='space-y-4'>
          <div className='flex items-center justify-between rounded-md border border-line bg-bg-2 px-3 py-2'>
            <span className='min-w-0 truncate text-13 text-fg-1'>{email}</span>
            <button
              type='button'
              className='shrink-0 text-13 text-accent hover:underline'
              onClick={() => {
                setEmail('');
                setError(null);
              }}
            >
              {t('register.step2.email_locked_change')}
            </button>
          </div>
          <div className='space-y-2'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='verification_code'>{t('register.step2.code_label')}</Label>
              <ResendCountdown onResend={() => sendCode(email)} />
            </div>
            <Input
              id='verification_code'
              autoComplete='one-time-code'
              {...accountForm.register('verification_code')}
            />
            {accountForm.formState.errors.verification_code && (
              <p className='text-12 text-danger'>
                {accountForm.formState.errors.verification_code.message}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='username'>{t('register.step2.username_label')}</Label>
            <Input id='username' autoComplete='username' {...accountForm.register('username')} />
            {accountForm.formState.errors.username && (
              <p className='text-12 text-danger'>{accountForm.formState.errors.username.message}</p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='password'>{t('register.step2.password_label')}</Label>
            <PasswordField
              id='password'
              autoComplete='new-password'
              {...accountForm.register('password')}
            />
            <PasswordStrengthBar value={accountForm.watch('password')} />
            {accountForm.formState.errors.password && (
              <p className='text-12 text-danger'>{accountForm.formState.errors.password.message}</p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='confirm_password'>{t('register.step2.password_confirm_label')}</Label>
            <PasswordField
              id='confirm_password'
              autoComplete='new-password'
              {...accountForm.register('confirm_password')}
            />
            {accountForm.formState.errors.confirm_password && (
              <p className='text-12 text-danger'>
                {accountForm.formState.errors.confirm_password.message}
              </p>
            )}
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={accountForm.formState.isSubmitting}>
            {accountForm.formState.isSubmitting
              ? t('register.step2.submit_loading')
              : t('register.step2.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
