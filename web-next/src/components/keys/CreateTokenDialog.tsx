import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useChannelGroups } from '@/hooks/useChannelGroups';
import { useCreateToken } from '@/hooks/useTokens';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(50),
  group: z.string().min(1),
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
    defaultValues: { name: '', group: '' },
  });

  useEffect(() => {
    if (groups.data && groups.data.length > 0 && !form.getValues('group')) {
      form.setValue('group', groups.data[0].name);
    }
  }, [groups.data, form]);

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync(values);
      form.reset();
      onOpenChange(false);
    } catch {
      /* InlineBanner below renders create.error */
    }
  }

  const submitDisabled = groups.isPending || groups.isError || create.isPending;

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
            <Select
              value={form.watch('group')}
              onValueChange={(v) => form.setValue('group', v, { shouldValidate: true })}
              disabled={groups.isPending || groups.isError}
            >
              <SelectTrigger id='create-group'>
                <SelectValue
                  placeholder={
                    groups.isPending ? t('create.loading_groups') : t('create.group')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.name} value={g.name}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type='submit' className='w-full' disabled={submitDisabled}>
            {t('create.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
