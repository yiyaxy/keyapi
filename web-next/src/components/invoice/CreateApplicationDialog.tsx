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
import { Textarea } from '@/components/ui/textarea';
import { useCreateInvoiceApplication, type InvoiceableOrder } from '@/hooks/useInvoice';
import { ApiError } from '@/lib/api';

const schema = z.object({
  invoice_type: z.string().min(1),
  title: z.string().min(1).max(255),
  tax_id: z.string().max(64).optional(),
  email: z.string().email(),
  apply_remark: z.string().max(2000).optional(),
});
type Values = z.infer<typeof schema>;

export function CreateApplicationDialog({
  open,
  selected,
  onOpenChange,
}: {
  open: boolean;
  selected: InvoiceableOrder[];
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('invoice');
  const create = useCreateInvoiceApplication();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      invoice_type: 'normal',
      title: '',
      tax_id: '',
      email: '',
      apply_remark: '',
    },
  });

  const totalAmount = selected.reduce((a, b) => a + b.money, 0);

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync({
        invoice_type: values.invoice_type,
        title: values.title,
        tax_id: values.tax_id,
        email: values.email,
        apply_remark: values.apply_remark,
        items: selected.map((s) => ({
          source_type: s.source_type,
          source_id: s.source_id,
        })),
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
        <div className='rounded-md border border-line bg-bg-1 px-3 py-2 text-12 text-fg-2'>
          {t('create.items.preview', {
            count: selected.length,
            amount: `¥${totalAmount.toFixed(2)}`,
          })}
        </div>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('create.invoice_type')}</Label>
            <Select
              // eslint-disable-next-line react-hooks/incompatible-library
              value={form.watch('invoice_type')}
              onValueChange={(v) => form.setValue('invoice_type', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='normal'>{t('create.invoice_type.normal')}</SelectItem>
                <SelectItem value='special'>{t('create.invoice_type.special')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='inv-title'>{t('create.title_field')}</Label>
            <Input id='inv-title' autoFocus {...form.register('title')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='inv-taxid'>{t('create.tax_id')}</Label>
            <Input id='inv-taxid' {...form.register('tax_id')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='inv-email'>{t('create.email')}</Label>
            <Input id='inv-email' type='email' {...form.register('email')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='inv-remark'>{t('create.apply_remark')}</Label>
            <Textarea id='inv-remark' rows={3} {...form.register('apply_remark')} />
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
