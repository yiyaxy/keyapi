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
import { Switch } from '@/components/ui/switch';
import {
  useCreateUserLevel,
  useUpdateUserLevel,
  type UserLevel,
} from '@/hooks/useUserLevels';
import { ApiError } from '@/lib/api';

const QUOTA_PER_UNIT = 500_000;

const schema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(64),
  description: z.string().max(255),
  register_reward_usd: z.number().min(0),
  invitee_reward_usd: z.number().min(0),
  top_up_bonus_percent: z.number().int().min(0).max(100),
  top_up_rebate_count: z.number().int().min(0),
  top_up_rebate_percent: z.number().int().min(0).max(100),
  subscription_rebate_count: z.number().int().min(0),
  enabled: z.boolean(),
  sort_order: z.number().int(),
});

type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  code: '',
  name: '',
  description: '',
  register_reward_usd: 0,
  invitee_reward_usd: 0,
  top_up_bonus_percent: 0,
  top_up_rebate_count: 0,
  top_up_rebate_percent: 0,
  subscription_rebate_count: 0,
  enabled: true,
  sort_order: 0,
};

function fromRecord(r: UserLevel): Values {
  return {
    code: r.code,
    name: r.name,
    description: r.description ?? '',
    register_reward_usd: r.register_reward / QUOTA_PER_UNIT,
    invitee_reward_usd: r.invitee_reward / QUOTA_PER_UNIT,
    top_up_bonus_percent: r.top_up_bonus_percent ?? 0,
    top_up_rebate_count: r.top_up_rebate_count,
    top_up_rebate_percent: r.top_up_rebate_percent,
    subscription_rebate_count: r.subscription_rebate_count,
    enabled: r.enabled,
    sort_order: r.sort_order,
  };
}

export function UserLevelFormDialog({
  open,
  record,
  onOpenChange,
}: {
  open: boolean;
  record: UserLevel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('rebate');
  const create = useCreateUserLevel();
  const update = useUpdateUserLevel();
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
      code: values.code.trim(),
      name: values.name.trim(),
      description: values.description.trim(),
      register_reward: Math.round(values.register_reward_usd * QUOTA_PER_UNIT),
      invitee_reward: Math.round(values.invitee_reward_usd * QUOTA_PER_UNIT),
      top_up_bonus_percent: values.top_up_bonus_percent,
      top_up_rebate_count: values.top_up_rebate_count,
      top_up_rebate_percent: values.top_up_rebate_percent,
      subscription_rebate_count: values.subscription_rebate_count,
      enabled: values.enabled,
      sort_order: values.sort_order,
    };
    try {
      if (record) {
        await update.mutateAsync({ ...body, id: record.id });
        toast.success(t('level.toast.update'));
      } else {
        await create.mutateAsync(body);
        toast.success(t('level.toast.create'));
      }
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
          <DialogTitle>{isEdit ? t('level.form.title.edit') : t('level.form.title.create')}</DialogTitle>
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
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ul-name'>{t('level.form.name')}</Label>
              <Input id='ul-name' {...form.register('name')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ul-code'>{t('level.form.code')}</Label>
              <Input id='ul-code' {...form.register('code')} />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ul-desc'>{t('level.form.description')}</Label>
            <Input id='ul-desc' {...form.register('description')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ul-rr'>{t('form.register_reward.label')}</Label>
              <Input
                id='ul-rr'
                type='number'
                step='0.01'
                min={0}
                {...form.register('register_reward_usd', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ul-ir'>{t('form.invitee_reward.label')}</Label>
              <Input
                id='ul-ir'
                type='number'
                step='0.01'
                min={0}
                {...form.register('invitee_reward_usd', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ul-bonusp'>{t('form.top_up_bonus_percent.label')}</Label>
              <Input
                id='ul-bonusp'
                type='number'
                min={0}
                max={100}
                {...form.register('top_up_bonus_percent', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ul-topc'>{t('form.top_up_rebate_count.label')}</Label>
              <Input
                id='ul-topc'
                type='number'
                min={0}
                {...form.register('top_up_rebate_count', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ul-topp'>{t('form.top_up_rebate_percent.label')}</Label>
              <Input
                id='ul-topp'
                type='number'
                min={0}
                max={100}
                {...form.register('top_up_rebate_percent', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ul-subc'>{t('form.subscription_rebate_count.label')}</Label>
              <Input
                id='ul-subc'
                type='number'
                min={0}
                {...form.register('subscription_rebate_count', { valueAsNumber: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ul-sort'>{t('level.form.sort_order')}</Label>
              <Input
                id='ul-sort'
                type='number'
                {...form.register('sort_order', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='flex items-center justify-between rounded-md border border-line bg-bg-1 p-3'>
            <Label htmlFor='ul-enabled'>{t('level.form.enabled')}</Label>
            <Switch
              id='ul-enabled'
              checked={form.watch('enabled')}
              onCheckedChange={(v) =>
                form.setValue('enabled', v, { shouldDirty: true, shouldValidate: true })
              }
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
