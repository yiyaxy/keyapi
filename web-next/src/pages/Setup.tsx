import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCompleteSetup, useSetupStatus } from '@/hooks/useSetup';
import { useSiteBranding } from '@/hooks/useSiteBranding';
import { ApiError } from '@/lib/api';

const schema = z
  .object({
    username: z.string().max(12),
    password: z.string(),
    confirmPassword: z.string(),
    SelfUseModeEnabled: z.boolean(),
    DemoSiteEnabled: z.boolean(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'mismatch',
    path: ['confirmPassword'],
  });
type Values = z.infer<typeof schema>;

export function SetupPage() {
  const { t } = useTranslation('setup');
  const status = useSetupStatus();
  const complete = useCompleteSetup();
  const navigate = useNavigate();
  const { systemName, logo } = useSiteBranding();
  const logoAlt = systemName || 'AllModels';

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: '',
      password: '',
      confirmPassword: '',
      SelfUseModeEnabled: false,
      DemoSiteEnabled: false,
    },
  });

  if (status.isPending) {
    return (
      <div className='mx-auto max-w-xl pt-16'>
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className='mx-auto max-w-xl pt-16'>
        <InlineBanner
          level='danger'
          message={String((status.error as Error).message)}
          onClose={() => void status.refetch()}
        />
      </div>
    );
  }

  const setupDone = status.data?.status === true;
  if (setupDone) {
    return (
      <div className='mx-auto max-w-xl space-y-4 pt-16'>
        <div className='flex items-center gap-3'>
          <Logo size={28} url={logo} alt={logoAlt} />
          <h1 className='text-20 font-semibold'>{t('already_done.title')}</h1>
        </div>
        <p className='text-13 text-fg-2'>{t('already_done.body')}</p>
        <Link to='/login'>
          <Button>{t('already_done.cta')}</Button>
        </Link>
      </div>
    );
  }

  const rootExists = status.data?.root_init === true;

  async function onSubmit(values: Values) {
    try {
      await complete.mutateAsync(values);
      toast.success(t('success'));
      setTimeout(() => navigate('/login', { replace: true }), 600);
    } catch {
      /* banner below */
    }
  }

  return (
    <div className='mx-auto max-w-xl space-y-6 pt-10'>
      <header className='flex items-center gap-3'>
        <Logo size={28} />
        <div>
          <h1 className='text-20 font-semibold'>{t('page.title')}</h1>
          <p className='text-13 text-fg-2'>{t('page.sub')}</p>
        </div>
      </header>

      {complete.error instanceof ApiError && (
        <InlineBanner
          level='danger'
          message={complete.error.backendMessage ?? complete.error.message}
        />
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <Card>
          <CardHeader>
            <CardTitle>{t('section.admin')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {rootExists ? (
              <InlineBanner level='info' message={t('admin.exists')} />
            ) : (
              <>
                <div className='space-y-2'>
                  <Label htmlFor='st-username'>{t('field.username')}</Label>
                  <Input
                    id='st-username'
                    autoFocus
                    autoComplete='username'
                    {...form.register('username')}
                  />
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <div className='space-y-2'>
                    <Label htmlFor='st-password'>{t('field.password')}</Label>
                    <Input
                      id='st-password'
                      type='password'
                      autoComplete='new-password'
                      {...form.register('password')}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='st-confirm'>{t('field.confirm')}</Label>
                    <Input
                      id='st-confirm'
                      type='password'
                      autoComplete='new-password'
                      {...form.register('confirmPassword')}
                    />
                    {form.formState.errors.confirmPassword?.message === 'mismatch' && (
                      <div className='text-12 text-danger'>{t('mismatch')}</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('section.options')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <Label className='text-13'>{t('field.self_use')}</Label>
                <div className='mt-1 text-12 text-fg-2'>{t('field.self_use.hint')}</div>
              </div>
              <Switch
                // eslint-disable-next-line react-hooks/incompatible-library
                checked={form.watch('SelfUseModeEnabled')}
                onCheckedChange={(v) => form.setValue('SelfUseModeEnabled', v)}
              />
            </div>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <Label className='text-13'>{t('field.demo')}</Label>
                <div className='mt-1 text-12 text-fg-2'>{t('field.demo.hint')}</div>
              </div>
              <Switch
                checked={form.watch('DemoSiteEnabled')}
                onCheckedChange={(v) => form.setValue('DemoSiteEnabled', v)}
              />
            </div>
          </CardContent>
        </Card>

        <div className='flex justify-end'>
          <Button type='submit' disabled={complete.isPending}>
            {t('submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
