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
    defaultValues: { name: '', slug: '' },
  });

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync(values);
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
