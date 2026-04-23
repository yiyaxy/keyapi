import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
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

const step1Schema = z.object({ email: z.string().email() });
type Step1Values = z.infer<typeof step1Schema>;

const step2Schema = z
  .object({
    code: z.string().min(1),
    username: z.string().optional(),
    password: z.string().min(6),
    password_confirm: z.string().min(6),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ['password_confirm'],
    message: 'mismatch',
  });
type Step2Values = z.infer<typeof step2Schema>;

const directSchema = z
  .object({
    username: z.string().optional(),
    password: z.string().min(6),
    password_confirm: z.string().min(6),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ['password_confirm'],
    message: 'mismatch',
  });
type DirectValues = z.infer<typeof directSchema>;

export function Register() {
  const { t } = useTranslation('auth');
  const { status, register } = useAuth();
  const cfg = usePublicConfig();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const registerEnabled = cfg.register_enabled !== false;
  const passwordRegisterEnabled = cfg.password_register_enabled !== false;
  const emailVerificationEnabled = cfg.email_verification !== false;

  const f1 = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: { email: '' },
  });
  const f2 = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { code: '', username: '', password: '', password_confirm: '' },
  });
  const fDirect = useForm<DirectValues>({
    resolver: zodResolver(directSchema),
    defaultValues: { username: '', password: '', password_confirm: '' },
  });
  // react-hook-form's watch() is a library constraint React Compiler can't memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const password = emailVerificationEnabled
    ? f2.watch('password') || ''
    : fDirect.watch('password') || '';

  if (status === 'authenticated') {
    return <Navigate to='/' replace />;
  }

  async function sendCode(targetEmail: string) {
    await api.get('/api/verification', { params: { email: targetEmail } });
  }

  async function onStep1(values: Step1Values) {
    setError(null);
    try {
      await sendCode(values.email);
      setEmail(values.email);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  async function onStep2(values: Step2Values) {
    setError(null);
    try {
      await register({
        email,
        password: values.password,
        username: values.username || undefined,
        verification_code: values.code,
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  async function onDirectSubmit(values: DirectValues) {
    setError(null);
    try {
      await register({
        email: '',
        password: values.password,
        username: values.username || undefined,
        verification_code: '',
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('register.eyebrow')}
      title={t('register.title')}
      footer={
        <>
          {t('register.to_login').replace(/→\s*$/, '')}
          <Link to='/login' className='ml-1 text-accent hover:underline'>
            {'→'}
          </Link>
        </>
      }
    >
      {!registerEnabled ? (
        <InlineBanner level='info' message='当前租户已关闭注册' />
      ) : !passwordRegisterEnabled ? (
        <InlineBanner level='info' message='当前租户未开放密码注册' />
      ) : emailVerificationEnabled ? (
        step === 1 ? (
          <form onSubmit={f1.handleSubmit(onStep1)} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='email'>{t('register.step1.email_label')}</Label>
              <Input
                id='email'
                type='email'
                autoFocus
                autoComplete='email'
                {...f1.register('email')}
              />
            </div>
            {error && (
              <InlineBanner level='danger' message={error} onClose={() => setError(null)} />
            )}
            <Button type='submit' className='w-full' disabled={f1.formState.isSubmitting}>
              {f1.formState.isSubmitting
                ? t('register.step1.sending')
                : t('register.step1.send_code')}
            </Button>
          </form>
        ) : (
          <form onSubmit={f2.handleSubmit(onStep2)} className='space-y-4'>
            <div className='flex items-center justify-between rounded-sm bg-bg-2 px-3 py-2'>
              <span className='mono text-13 text-fg-0'>{email}</span>
              <button
                type='button'
                className='text-13 text-accent hover:underline'
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
              >
                {t('register.step2.email_locked_change')}
              </button>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='code'>{t('register.step2.code_label')}</Label>
                <ResendCountdown onResend={() => sendCode(email)} initialSeconds={60} />
              </div>
              <Input
                id='code'
                autoFocus
                inputMode='numeric'
                maxLength={6}
                autoComplete='one-time-code'
                {...f2.register('code')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='username'>{t('register.step2.username_label')}</Label>
              <Input id='username' autoComplete='username' {...f2.register('username')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='password'>{t('register.step2.password_label')}</Label>
              <PasswordField
                id='password'
                autoComplete='new-password'
                {...f2.register('password')}
              />
              <PasswordStrengthBar value={password} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='password_confirm'>{t('register.step2.password_confirm_label')}</Label>
              <PasswordField
                id='password_confirm'
                autoComplete='new-password'
                {...f2.register('password_confirm')}
              />
            </div>
            {error && (
              <InlineBanner level='danger' message={error} onClose={() => setError(null)} />
            )}
            <Button type='submit' className='w-full' disabled={f2.formState.isSubmitting}>
              {f2.formState.isSubmitting
                ? t('register.step2.submit_loading')
                : t('register.step2.submit')}
            </Button>
          </form>
        )
      ) : (
        <form onSubmit={fDirect.handleSubmit(onDirectSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='username'>{t('register.step2.username_label')}</Label>
            <Input id='username' autoComplete='username' {...fDirect.register('username')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='password'>{t('register.step2.password_label')}</Label>
            <PasswordField
              id='password'
              autoComplete='new-password'
              {...fDirect.register('password')}
            />
            <PasswordStrengthBar value={password} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='password_confirm'>{t('register.step2.password_confirm_label')}</Label>
            <PasswordField
              id='password_confirm'
              autoComplete='new-password'
              {...fDirect.register('password_confirm')}
            />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={fDirect.formState.isSubmitting}>
            {fDirect.formState.isSubmitting
              ? t('register.step2.submit_loading')
              : t('register.step2.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
