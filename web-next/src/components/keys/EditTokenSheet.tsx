import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useChannelGroups } from '@/hooks/useChannelGroups';
import { useUpdateToken, type Token } from '@/hooks/useTokens';
import { ApiError } from '@/lib/api';
import {
  editTokenSchema,
  parseAllowIps,
  parseGroupChain,
  serializeAllowIps,
  serializeGroupChain,
  type EditTokenValues,
} from '@/lib/token-schema';

export function EditTokenSheet({
  open,
  token,
  onOpenChange,
}: {
  open: boolean;
  token: Token;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('keys');
  const models = useAvailableModels();
  const groups = useChannelGroups();
  const update = useUpdateToken();

  const form = useForm<EditTokenValues>({
    resolver: zodResolver(editTokenSchema),
    defaultValues: {
      name: token.name ?? '',
      status: (token.status === 2 ? 2 : 1) as 1 | 2,
      unlimited_quota: token.unlimited_quota,
      remain_quota: token.remain_quota,
      expired_time: token.expired_time,
      model_limits_enabled: token.model_limits_enabled,
      model_limits: token.model_limits ? token.model_limits.split(',').filter(Boolean) : [],
      allow_ips: parseAllowIps(token.allow_ips ?? ''),
      group: parseGroupChain(token.group),
      cross_group_retry: token.cross_group_retry,
    },
  });

  useEffect(() => {
    form.reset({
      name: token.name ?? '',
      status: (token.status === 2 ? 2 : 1) as 1 | 2,
      unlimited_quota: token.unlimited_quota,
      remain_quota: token.remain_quota,
      expired_time: token.expired_time,
      model_limits_enabled: token.model_limits_enabled,
      model_limits: token.model_limits ? token.model_limits.split(',').filter(Boolean) : [],
      allow_ips: parseAllowIps(token.allow_ips ?? ''),
      group: parseGroupChain(token.group),
      cross_group_retry: token.cross_group_retry,
    });
  }, [token, form]);

  /* eslint-disable react-hooks/incompatible-library -- rhf watch() is by design */
  const unlimited = form.watch('unlimited_quota');
  const modelLimits = form.watch('model_limits');
  const groupChain = form.watch('group');
  /* eslint-enable react-hooks/incompatible-library */

  async function onSubmit(values: EditTokenValues) {
    try {
      await update.mutateAsync({
        id: token.id,
        name: values.name,
        status: values.status,
        unlimited_quota: values.unlimited_quota,
        remain_quota: values.remain_quota,
        expired_time: values.expired_time,
        model_limits_enabled: values.model_limits_enabled,
        model_limits: values.model_limits.join(','),
        allow_ips: serializeAllowIps(values.allow_ips),
        group: serializeGroupChain(values.group),
        cross_group_retry: values.cross_group_retry,
      });
      onOpenChange(false);
    } catch {
      /* banner via state */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
        </DialogHeader>
        {update.error && update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='e-name'>{t('edit.field.name')}</Label>
            <Input id='e-name' {...form.register('name')} />
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.status')}</Label>
            <Switch
              checked={form.watch('status') === 1}
              onCheckedChange={(v) => form.setValue('status', v ? 1 : 2)}
              disabled={token.status === 3 || token.status === 4}
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.unlimited_quota')}</Label>
            <Switch
              checked={unlimited}
              onCheckedChange={(v) => form.setValue('unlimited_quota', v)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='e-quota'>{t('edit.field.remain_quota')}</Label>
            <Input
              id='e-quota'
              type='number'
              disabled={unlimited}
              {...form.register('remain_quota', { valueAsNumber: true })}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.expired_time')}</Label>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() => form.setValue('expired_time', -1)}
              >
                {t('edit.field.expired_time.never')}
              </Button>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() =>
                  form.setValue('expired_time', Math.floor(Date.now() / 1000) + 7 * 86400)
                }
              >
                {t('edit.field.expired_time.7d')}
              </Button>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() =>
                  form.setValue('expired_time', Math.floor(Date.now() / 1000) + 30 * 86400)
                }
              >
                {t('edit.field.expired_time.30d')}
              </Button>
            </div>
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.model_limits')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type='button' variant='secondary' className='w-full justify-start'>
                  {modelLimits.length === 0
                    ? t('edit.field.model_limits.placeholder')
                    : `${modelLimits.length} selected`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className='max-h-64 overflow-y-auto'>
                {(models.data ?? []).map((m) => {
                  const checked = modelLimits.includes(m);
                  return (
                    <label key={m} className='flex items-center gap-2 rounded-sm p-1 hover:bg-bg-1'>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v ? [...modelLimits, m] : modelLimits.filter((x) => x !== m);
                          form.setValue('model_limits', next);
                          form.setValue('model_limits_enabled', next.length > 0);
                        }}
                      />
                      <span className='text-13'>{m}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='e-ips'>{t('edit.field.allow_ips')}</Label>
            <Textarea
              id='e-ips'
              rows={3}
              defaultValue={(form.getValues('allow_ips') ?? []).join('\n')}
              onChange={(e) => form.setValue('allow_ips', parseAllowIps(e.target.value))}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.group')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type='button' variant='secondary' className='w-full justify-start'>
                  {groupChain.join(' → ') || '—'}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                {(groups.data ?? []).map((g) => {
                  const checked = groupChain.includes(g.name);
                  return (
                    <label
                      key={g.name}
                      className='flex items-center gap-2 rounded-sm p-1 hover:bg-bg-1'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...groupChain, g.name]
                            : groupChain.filter((x) => x !== g.name);
                          form.setValue('group', next, { shouldValidate: true });
                        }}
                      />
                      <span className='text-13'>{g.name}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.cross_group_retry')}</Label>
            <Switch
              checked={form.watch('cross_group_retry')}
              onCheckedChange={(v) =>
                form.setValue('cross_group_retry', v, { shouldValidate: true })
              }
              disabled={groupChain.length < 2}
            />
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('edit.cancel')}
            </Button>
            <Button type='submit' disabled={update.isPending}>
              {t('edit.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
