import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';

export function Reset() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const email = params.get('email');
  const token = params.get('token');
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const id = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [copied]);

  if (!email || !token) {
    return <Navigate to='/forgot' replace />;
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<string>('/api/user/reset', { email, token });
      setNewPassword(res.data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!newPassword) return;
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
  }

  return (
    <AuthLayout
      eyebrow={t('reset.eyebrow')}
      title={newPassword ? t('reset.success_title') : t('reset.title')}
      footer={
        newPassword ? (
          <Link to='/login' className='text-accent hover:underline'>
            {t('reset.go_login')}
          </Link>
        ) : (
          <Link to='/login' className='text-accent hover:underline'>
            {t('forgot.back_to_login')}
          </Link>
        )
      }
    >
      {newPassword ? (
        <div className='space-y-4'>
          <p className='text-13 text-fg-1'>{t('reset.success_body')}</p>
          <div className='flex items-center justify-between rounded-sm bg-bg-2 px-3 py-2'>
            <span className='mono text-16 font-semibold'>{newPassword}</span>
            <button
              type='button'
              aria-label='copy'
              onClick={copy}
              className='rounded-xs p-1 text-fg-1 hover:bg-bg-3 hover:text-fg-0'
            >
              {copied ? (
                <Check size={16} strokeWidth={1.5} />
              ) : (
                <Copy size={16} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <div className='eyebrow'>{t('reset.email_label')}</div>
            <div className='mono text-13 text-fg-0'>{email}</div>
          </div>
          <p className='text-13 text-fg-1'>{t('reset.explain')}</p>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='button' className='w-full' disabled={submitting} onClick={submit}>
            {submitting ? t('reset.submitting') : t('reset.submit')}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
