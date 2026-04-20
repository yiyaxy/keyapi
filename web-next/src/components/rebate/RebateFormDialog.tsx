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
  useCreateRebateSetting,
  useUpdateRebateSetting,
  type UserRebateSetting,
} from '@/hooks/useRebateSettings';
import { ApiError } from '@/lib/api';

const QUOTA_PER_UNIT = 500_000;

const schema = z.object({
  inviter_id: z.number().int().positive(),
  register_reward_usd: z.number().min(0),
  invitee_reward_usd: z.number().min(0),
  top_up_rebate_count: z.number().int().min(0),
  top_up_rebate_percent: z.number().int().min(0).max(100),
  subscription_rebate_count: z.number().int().min(0),
});
type Values = z.infer<typeof schema>;

function fromRecord(r: UserRebateSetting): Values {
  return {
    inviter_id: r.inviter_id,
    register_reward_usd: r.register_reward / QUOTA_PER_UNIT,
    invitee_reward_usd: r.invitee_reward / QUOTA_PER_UNIT,
    top_up_rebate_count: r.top_up_rebate_count,
    top_up_rebate_percent: r.top_up_rebate_percent,
    subscription_rebate_count: r.subscription_rebate_count,
  };
}

const EMPTY: Values = {
  inviter_id: 0,
  register_reward_usd: 0,
  invitee_reward_usd: 0,
  top_up_rebate_count: 0,
  top_up_rebate_percent: 0,
  subscription_rebate_count: 0,
};

export function RebateFormDialog({
  open,
  record,
  onOpenChange,
}: {
  open: boolean;
  record: UserRebateSetting | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('rebate');
  const create = useCreateRebateSetting();
  const update = useUpdateRebateSetting();
  const isEdit = Boolean(record);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: record ? fromRecord(record) : EMPTY,
  });

  useEffect(() => {
    form.reset(record ? fromRecord(record) : EMPTY);
  }, [record, form]);

  async function onSubmit(values: Values) {
    const body = {
      inviter_id: values.inviter_id,
      register_reward: Math.round(values.register_reward_usd * QUOTA_PER_UNIT),
      invitee_reward: Math.round(values.invitee_reward_usd * QUOTA_PER_UNIT),
      top_up_rebate_count: values.top_up_rebate_count,
      top_up_rebate_percent: values.top_up_rebate_percent,
      subscription_rebate_count: values.subscription_rebate_count,
    };
    try {
      if (record) {
        await update.mutateAsync({ ...body, id: record.id });
        toast.success(t('toast.update.success'));
      } else {
        await create.mutateAsync(body);
        toast.success(t('toast.create.success'));
      }
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  const mutation = isEdit ? update : create;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[540px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.title.edit') : t('form.title.create')}</DialogTitle>
        </DialogHeader>
        {mutation.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={mutation.error.backendMessage ?? mutation.error.message}
          />
        )}
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className='max-h-[65vh] space-y-3 overflow-y-auto'
        >
          <div className='space-y-2'>
            <Label htmlFor='r-inviter'>{t('form.inviter_id.label')}</Label>
            <Input
              id='r-inviter'
              type='number'
              min={1}
              disabled={isEdit}
              {...form.register('inviter_id', { valueAsNumber: true })}
            />
            <p className='text-12 text-fg-2'>{t('form.inviter_id.help')}</p>
            {form.formState.errors.inviter_id && (
              <p className='text-12 text-danger'>{t('form.validate.inviter_id')}</p>
            )}
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='r-rr'>{t('form.register_reward.label')}</Label>
              <Input
                id='r-rr'
                type='number'
                step='0.01'
                min={0}
                {...form.register('register_reward_usd', {
                  valueAsNumber: true,
                })}
              />
              <p className='text-12 text-fg-2'>{t('form.register_reward.help')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='r-ir'>{t('form.invitee_reward.label')}</Label>
              <Input
                id='r-ir'
                type='number'
                step='0.01'
                min={0}
                {...form.register('invitee_reward_usd', {
                  valueAsNumber: true,
                })}
              />
              <p className='text-12 text-fg-2'>{t('form.invitee_reward.help')}</p>
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='r-topc'>{t('form.top_up_rebate_count.label')}</Label>
              <Input
                id='r-topc'
                type='number'
                min={0}
                {...form.register('top_up_rebate_count', {
                  valueAsNumber: true,
                })}
              />
              <p className='text-12 text-fg-2'>{t('form.top_up_rebate_count.help')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='r-topp'>{t('form.top_up_rebate_percent.label')}</Label>
              <Input
                id='r-topp'
                type='number'
                min={0}
                max={100}
                {...form.register('top_up_rebate_percent', {
                  valueAsNumber: true,
                })}
              />
              <p className='text-12 text-fg-2'>{t('form.top_up_rebate_percent.help')}</p>
              {form.formState.errors.top_up_rebate_percent && (
                <p className='text-12 text-danger'>{t('form.validate.percent')}</p>
              )}
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='r-subc'>{t('form.subscription_rebate_count.label')}</Label>
            <Input
              id='r-subc'
              type='number'
              min={0}
              {...form.register('subscription_rebate_count', {
                valueAsNumber: true,
              })}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('form.cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {t('form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
