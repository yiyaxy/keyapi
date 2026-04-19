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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateUser } from '@/hooks/useUsers';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1).max(20),
  password: z.string().min(8).max(20),
  display_name: z.string().max(20).optional(),
  role: z.number().int(),
});
type Values = z.infer<typeof schema>;

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('users');
  const create = useCreateUser();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '', display_name: '', role: 1 },
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
            <Label htmlFor='cu-username'>{t('create.username')}</Label>
            <Input id='cu-username' autoFocus {...form.register('username')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='cu-password'>{t('create.password')}</Label>
            <Input id='cu-password' type='password' {...form.register('password')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='cu-display'>{t('create.display_name')}</Label>
            <Input id='cu-display' {...form.register('display_name')} />
          </div>
          <div className='space-y-2'>
            <Label>{t('create.role')}</Label>
            <Select
              // eslint-disable-next-line react-hooks/incompatible-library
              value={String(form.watch('role'))}
              onValueChange={(v) => form.setValue('role', Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1'>{t('role.user')}</SelectItem>
                <SelectItem value='10'>{t('role.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('create.cancel')}
            </Button>
            <Button type='submit' disabled={create.isPending}>
              {t('create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
