import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateTenant } from '@/hooks/usePlatformTenants';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'invalid-slug'),
  admin_username: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_\-.]+$/, 'invalid-username'),
  admin_password: z.string().min(8).max(20),
  admin_email: z.string().email().optional().or(z.literal('')),
  admin_display_name: z.string().max(20).optional().or(z.literal('')),
});
type Values = z.infer<typeof schema>;

export function CreateTenantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const create = useCreateTenant();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      admin_username: '',
      admin_password: '',
      admin_email: '',
      admin_display_name: '',
    },
  });

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync({
        name: values.name,
        slug: values.slug,
        admin_username: values.admin_username,
        admin_password: values.admin_password,
        admin_email: values.admin_email || undefined,
        admin_display_name: values.admin_display_name || undefined,
      });
      toast.success(t('create.success'));
      form.reset();
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
        </DialogHeader>
        {create.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={create.error.backendMessage ?? create.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='ct-name'>{t('create.name')}</Label>
            <Input id='ct-name' autoFocus {...form.register('name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ct-slug'>{t('create.slug')}</Label>
            <Input id='ct-slug' {...form.register('slug')} />
            <div className='text-12 text-fg-2'>{t('create.slug.hint')}</div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ct-admin-username'>初始管理员用户名</Label>
            <Input id='ct-admin-username' {...form.register('admin_username')} />
            <div className='text-12 text-fg-2'>
              字母/数字/下划线/连字符/点，1-20 位。该账号自动成为此租户的 admin。
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ct-admin-password'>初始管理员密码</Label>
            <Input
              id='ct-admin-password'
              type='password'
              autoComplete='new-password'
              {...form.register('admin_password')}
            />
            <div className='text-12 text-fg-2'>8-20 位，创建后请及时通知该租户使用人并修改。</div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ct-admin-email'>管理员邮箱（可选）</Label>
            <Input id='ct-admin-email' type='email' {...form.register('admin_email')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ct-admin-display'>管理员显示名（可选）</Label>
            <Input id='ct-admin-display' {...form.register('admin_display_name')} />
          </div>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('create.cancel')}
            </Button>
            <Button type='submit' disabled={create.isPending}>
              {t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
