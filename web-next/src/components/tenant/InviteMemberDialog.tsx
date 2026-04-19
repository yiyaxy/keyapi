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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInviteMember } from '@/hooks/useTenant';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1).max(20),
  role: z.number().int(),
});
type Values = z.infer<typeof schema>;

export function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('tenant');
  const invite = useInviteMember();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', role: 1 },
  });

  async function onSubmit(values: Values) {
    try {
      await invite.mutateAsync(values);
      toast.success(t('invite.success'));
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
          <DialogTitle>{t('invite.title')}</DialogTitle>
        </DialogHeader>
        {invite.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={invite.error.backendMessage ?? invite.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='inv-username'>{t('invite.username')}</Label>
            <Input id='inv-username' autoFocus {...form.register('username')} />
          </div>
          <div className='space-y-2'>
            <Label>{t('invite.role')}</Label>
            <Select
              // eslint-disable-next-line react-hooks/incompatible-library
              value={String(form.watch('role'))}
              onValueChange={(v) => form.setValue('role', Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1'>{t('members.role.member')}</SelectItem>
                <SelectItem value='10'>{t('members.role.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('invite.cancel')}
            </Button>
            <Button type='submit' disabled={invite.isPending}>
              {t('invite.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
