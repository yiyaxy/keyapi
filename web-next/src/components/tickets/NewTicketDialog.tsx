import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { Textarea } from '@/components/ui/textarea';
import { useCreateTicket } from '@/hooks/useTickets';
import { ApiError } from '@/lib/api';

const schema = z.object({
  subject: z.string().min(1).max(120),
  content: z.string().min(1),
});
type Values = z.infer<typeof schema>;

export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('tickets');
  const create = useCreateTicket();
  const navigate = useNavigate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { subject: '', content: '' },
  });

  async function onSubmit(values: Values) {
    try {
      const res = await create.mutateAsync(values);
      toast.success(t('create.success'));
      form.reset();
      onOpenChange(false);
      navigate(`/tickets/${res.ticket.id}`);
    } catch {
      /* banner */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[520px]'>
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
            <Label htmlFor='t-subject'>{t('create.subject')}</Label>
            <Input id='t-subject' autoFocus {...form.register('subject')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='t-content'>{t('create.content')}</Label>
            <Textarea id='t-content' rows={8} {...form.register('content')} />
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
