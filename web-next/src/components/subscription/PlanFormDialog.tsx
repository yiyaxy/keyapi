import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
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
import {
  useAdminCreatePlan,
  useAdminUpdatePlan,
  type AdminPlanInput,
  type SubscriptionPlanDTO,
} from '@/hooks/useSubscription';
import { ApiError } from '@/lib/api';

const schema = z.object({
  title: z.string().min(1).max(128),
  subtitle: z.string().max(255),
  promo_highlights: z.string().max(4000),
  price_amount: z.number().min(0).max(9999),
  duration_unit: z.string().min(1),
  duration_value: z.number().int().min(0),
  sort_order: z.number().int(),
  status: z.string().min(1),
  max_purchase_per_user: z.number().int().min(0),
  upgrade_group: z.string().max(64),
});
type Values = z.infer<typeof schema>;

function fromPlan(p: SubscriptionPlanDTO): Values {
  return {
    title: p.title,
    subtitle: p.subtitle,
    promo_highlights: p.promo_highlights,
    price_amount: p.price_amount,
    duration_unit: p.duration_unit || 'month',
    duration_value: p.duration_value || 1,
    sort_order: p.sort_order ?? 0,
    status: p.status || 'active',
    max_purchase_per_user: p.max_purchase_per_user ?? 0,
    upgrade_group: p.upgrade_group ?? '',
  };
}

const EMPTY: Values = {
  title: '',
  subtitle: '',
  promo_highlights: '',
  price_amount: 0,
  duration_unit: 'month',
  duration_value: 1,
  sort_order: 0,
  status: 'active',
  max_purchase_per_user: 0,
  upgrade_group: '',
};

export function PlanFormDialog({
  open,
  plan,
  onOpenChange,
}: {
  open: boolean;
  plan: SubscriptionPlanDTO | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('plan');
  const create = useAdminCreatePlan();
  const update = useAdminUpdatePlan();
  const isEdit = Boolean(plan);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: plan ? fromPlan(plan) : EMPTY,
  });

  useEffect(() => {
    form.reset(plan ? fromPlan(plan) : EMPTY);
  }, [plan, form]);

  async function onSubmit(values: Values) {
    const payload: AdminPlanInput = {
      title: values.title,
      subtitle: values.subtitle,
      promo_highlights: values.promo_highlights,
      price_amount: values.price_amount,
      currency: 'USD',
      duration_unit: values.duration_unit,
      duration_value: values.duration_value,
      sort_order: values.sort_order,
      status: values.status,
      enabled: values.status === 'active',
      max_purchase_per_user: values.max_purchase_per_user,
      upgrade_group: values.upgrade_group,
    };
    try {
      if (plan) {
        await update.mutateAsync({ id: plan.id, plan: payload });
      } else {
        await create.mutateAsync(payload);
      }
      toast.success(t('admin.save.success'));
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  const mutation = isEdit ? update : create;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'admin.edit.title' : 'admin.create.title')}</DialogTitle>
        </DialogHeader>
        {mutation.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={mutation.error.backendMessage ?? mutation.error.message}
          />
        )}
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className='max-h-[70vh] space-y-3 overflow-y-auto'
        >
          <div className='space-y-2'>
            <Label htmlFor='p-title'>{t('admin.field.title')}</Label>
            <Input id='p-title' autoFocus {...form.register('title')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-subtitle'>{t('admin.field.subtitle')}</Label>
            <Input id='p-subtitle' {...form.register('subtitle')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='p-price'>{t('admin.field.price')}</Label>
              <Input
                id='p-price'
                type='number'
                step={0.01}
                min={0}
                {...form.register('price_amount', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='p-sort'>{t('admin.field.sort_order')}</Label>
              <Input
                id='p-sort'
                type='number'
                {...form.register('sort_order', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label>{t('admin.field.duration_unit')}</Label>
              <Select
                // eslint-disable-next-line react-hooks/incompatible-library
                value={form.watch('duration_unit')}
                onValueChange={(v) => form.setValue('duration_unit', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='month'>{t('admin.field.duration_unit.month')}</SelectItem>
                  <SelectItem value='year'>{t('admin.field.duration_unit.year')}</SelectItem>
                  <SelectItem value='day'>{t('admin.field.duration_unit.day')}</SelectItem>
                  <SelectItem value='custom'>{t('admin.field.duration_unit.custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='p-duration-value'>{t('admin.field.duration_value')}</Label>
              <Input
                id='p-duration-value'
                type='number'
                min={0}
                {...form.register('duration_value', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label>{t('admin.field.status')}</Label>
              <Select
                value={form.watch('status')}
                onValueChange={(v) => form.setValue('status', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='active'>{t('admin.status.active')}</SelectItem>
                  <SelectItem value='sold_out'>{t('admin.status.sold_out')}</SelectItem>
                  <SelectItem value='archived'>{t('admin.status.archived')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='p-max-per-user'>{t('admin.field.max_purchase_per_user')}</Label>
              <Input
                id='p-max-per-user'
                type='number'
                min={0}
                {...form.register('max_purchase_per_user', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-upgrade'>{t('admin.field.upgrade_group')}</Label>
            <Input id='p-upgrade' {...form.register('upgrade_group')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-highlights'>{t('admin.field.promo_highlights')}</Label>
            <Textarea id='p-highlights' rows={4} {...form.register('promo_highlights')} />
          </div>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('admin.cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {t('admin.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
