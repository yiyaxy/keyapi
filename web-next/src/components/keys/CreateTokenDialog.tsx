import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useChannelGroups } from '@/hooks/useChannelGroups';
import { useCreateToken } from '@/hooks/useTokens';
import { ApiError } from '@/lib/api';
import { serializeGroupChain } from '@/lib/token-schema';

const schema = z
  .object({
    name: z.string().min(1).max(50),
    group: z.array(z.string()).min(1),
    cross_group_retry: z.boolean(),
  })
  .refine((v) => !v.cross_group_retry || v.group.length >= 2, {
    path: ['cross_group_retry'],
    message: 'cross_group_retry requires ≥ 2 groups',
  });
type Values = z.infer<typeof schema>;

export function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('keys');
  const groups = useChannelGroups();
  const create = useCreateToken();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', group: [], cross_group_retry: false },
  });

  useEffect(() => {
    if (groups.data && groups.data.length > 0 && form.getValues('group').length === 0) {
      form.setValue('group', [groups.data[0].name]);
    }
  }, [groups.data, form]);

  /* eslint-disable react-hooks/incompatible-library -- rhf watch() is by design */
  const groupChain = form.watch('group');
  const crossGroupRetry = form.watch('cross_group_retry');
  /* eslint-enable react-hooks/incompatible-library */

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync({
        name: values.name,
        group: serializeGroupChain(values.group),
        cross_group_retry: values.cross_group_retry,
      });
      form.reset();
      onOpenChange(false);
    } catch {
      /* InlineBanner below renders create.error */
    }
  }

  const groupsEmpty = groups.isSuccess && (groups.data?.length ?? 0) === 0;
  const groupsDisabled = groups.isPending || groups.isError || groupsEmpty;
  const submitDisabled = groupsDisabled || create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.hint_advanced')}</DialogDescription>
        </DialogHeader>
        {groups.isError && (
          <InlineBanner
            level='danger'
            message={t('create.groups_failed')}
            onClose={() => void groups.refetch()}
          />
        )}
        {groupsEmpty && <InlineBanner level='warn' message={t('create.groups_empty')} />}
        {create.error && create.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={create.error.backendMessage ?? create.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='create-name'>{t('create.name')}</Label>
            <Input id='create-name' autoFocus {...form.register('name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='create-group'>{t('create.group')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id='create-group'
                  type='button'
                  variant='secondary'
                  className='w-full justify-start'
                  disabled={groupsDisabled}
                >
                  {groupChain.length === 0
                    ? groups.isPending
                      ? t('create.loading_groups')
                      : t('create.group')
                    : groupChain.join(' → ')}
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
              checked={crossGroupRetry}
              onCheckedChange={(v) =>
                form.setValue('cross_group_retry', v, { shouldValidate: true })
              }
              disabled={groupChain.length < 2}
            />
          </div>
          <Button type='submit' className='w-full' disabled={submitDisabled}>
            {t('create.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
