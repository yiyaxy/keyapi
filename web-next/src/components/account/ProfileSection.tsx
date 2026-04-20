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
import { type User } from '@/hooks/useAuth';
import { useUpdateSelf } from '@/hooks/useUpdateSelf';
import { ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;

const schema = z.object({
  display_name: z.string().max(20).optional(),
});
type Values = z.infer<typeof schema>;

function roleLabel(role: number, platformRole: number): 'user' | 'admin' | 'root' {
  if (platformRole >= 100) return 'root';
  if (role >= 10) return 'admin';
  return 'user';
}

export function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation('account');
  const update = useUpdateSelf();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: user.display_name ?? '' },
  });

  async function onSubmit(values: Values) {
    try {
      await update.mutateAsync({
        username: user.username,
        display_name: values.display_name ?? '',
      });
      toast.success(t('profile.saved'));
    } catch {
      /* banner below */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
          />
        )}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='space-y-1'>
            <Label className='text-fg-2'>{t('profile.username')}</Label>
            <div className='text-13 text-fg-0'>{user.username}</div>
          </div>
          <div className='space-y-1'>
            <Label className='text-fg-2'>{t('profile.email')}</Label>
            <div className='text-13 text-fg-0'>{user.email || t('profile.empty')}</div>
          </div>
          <div className='space-y-1'>
            <Label className='text-fg-2'>{t('profile.group')}</Label>
            <div className='text-13 text-fg-0'>{user.group}</div>
          </div>
          <div className='space-y-1'>
            <Label className='text-fg-2'>{t('profile.balance')}</Label>
            <div className='text-13 tabular-nums text-fg-0'>
              {fmtMoney(user.quota / QUOTA_PER_UNIT)}
            </div>
          </div>
          <div className='space-y-1'>
            <Label className='text-fg-2'>Role</Label>
            <div className='text-13 text-fg-0'>
              {t(`profile.role.${roleLabel(user.role, user.platform_role)}`)}
            </div>
          </div>
        </div>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-3'>
          <div className='space-y-2'>
            <Label htmlFor='account-display-name'>{t('profile.display_name')}</Label>
            <Input id='account-display-name' {...form.register('display_name')} />
          </div>
          <div className='flex justify-end'>
            <Button type='submit' disabled={update.isPending || !form.formState.isDirty}>
              {t('profile.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
