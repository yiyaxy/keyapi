import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { RechargeCard } from '@/components/topup/RechargeCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { useRedeem } from '@/hooks/useRedeem';
import { useTopupInfo } from '@/hooks/useTopup';
import { ApiError } from '@/lib/api';
import { fmtDisplay } from '@/lib/format';

export function TopupPage() {
  const { t } = useTranslation('topup');
  const { user, status } = useAuth();
  const cfg = usePublicConfig();
  const redeem = useRedeem();
  const topupInfo = useTopupInfo();
  const [code, setCode] = useState('');

  if (status === 'loading') {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-40 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }
  if (!user) {
    return <Navigate to='/login' replace />;
  }

  const totalQuota = user.quota + user.used_quota;
  const selfTopupEnabled = topupInfo.data?.self_topup_enabled ?? true;

  async function onRedeem() {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error(t('redeem.empty'));
      return;
    }
    try {
      const amount = await redeem.mutateAsync(trimmed);
      toast.success(
        t('redeem.success', {
          amount: fmtDisplay(amount, cfg),
        })
      );
      setCode('');
    } catch {
      /* banner renders inside redeem.error */
    }
  }

  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle>{t('balance.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='text-40 font-semibold tabular-nums'>
            {fmtDisplay(user.quota, cfg)}
          </div>
          <div className='mt-1 text-13 text-fg-2'>
            {t('balance.used', {
              used: fmtDisplay(user.used_quota, cfg),
              total: fmtDisplay(totalQuota, cfg),
            })}
          </div>
        </CardContent>
      </Card>
      {selfTopupEnabled && (
        <>
          <RechargeCard />
          <Card>
            <CardHeader>
              <CardTitle>{t('redeem.title')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <p className='text-13 text-fg-2'>{t('redeem.body')}</p>
              {redeem.error instanceof ApiError && (
                <InlineBanner
                  level='danger'
                  message={redeem.error.backendMessage ?? redeem.error.message}
                />
              )}
              <div className='flex gap-2'>
                <Input
                  value={code}
                  placeholder={t('redeem.placeholder')}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onRedeem();
                  }}
                />
                <Button onClick={() => void onRedeem()} disabled={redeem.isPending}>
                  {t('redeem.submit')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle>{t('contact.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-13 text-fg-2'>{t('contact.body')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
