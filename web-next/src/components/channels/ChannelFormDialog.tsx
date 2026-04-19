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
  useCreateChannel,
  useUpdateChannel,
  type Channel,
} from '@/hooks/useChannels';
import { ApiError } from '@/lib/api';
import { CHANNEL_TYPES } from '@/lib/channelTypes';

const schema = z.object({
  name: z.string().min(1).max(60),
  type: z.number().int().min(0),
  key: z.string(),
  base_url: z.string(),
  models: z.string(),
  group: z.string().min(1),
  priority: z.number().int().min(0).max(100),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  name: '',
  type: 1,
  key: '',
  base_url: '',
  models: '',
  group: 'default',
  priority: 0,
};

function fromChannel(ch: Channel): Values {
  return {
    name: ch.name,
    type: ch.type,
    key: '',
    base_url: ch.base_url ?? '',
    models: ch.models,
    group: ch.group,
    priority: ch.priority ?? 0,
  };
}

export function ChannelFormDialog({
  open,
  channel,
  onOpenChange,
}: {
  open: boolean;
  channel: Channel | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('channels');
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const isEdit = Boolean(channel);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: channel ? fromChannel(channel) : EMPTY,
  });

  useEffect(() => {
    form.reset(channel ? fromChannel(channel) : EMPTY);
  }, [channel, form]);

  async function onSubmit(values: Values) {
    try {
      if (channel) {
        const payload: Parameters<typeof update.mutateAsync>[0] = {
          id: channel.id,
          name: values.name,
          type: values.type,
          base_url: values.base_url || undefined,
          models: values.models,
          group: values.group,
          priority: values.priority,
        };
        if (values.key.trim()) payload.key = values.key.trim();
        await update.mutateAsync(payload);
      } else {
        await create.mutateAsync({
          name: values.name,
          type: values.type,
          key: values.key,
          base_url: values.base_url || undefined,
          models: values.models,
          group: values.group,
          priority: values.priority,
        });
      }
      toast.success(t('form.saved'));
      onOpenChange(false);
      form.reset(EMPTY);
    } catch {
      /* banner below */
    }
  }

  const mutation = isEdit ? update : create;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'form.edit_title' : 'form.create_title')}</DialogTitle>
        </DialogHeader>
        {mutation.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={mutation.error.backendMessage ?? mutation.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ch-name'>{t('form.field.name')}</Label>
              <Input id='ch-name' {...form.register('name')} />
            </div>
            <div className='space-y-2'>
              <Label>{t('form.field.type')}</Label>
              <Select
                // eslint-disable-next-line react-hooks/incompatible-library
                value={String(form.watch('type'))}
                onValueChange={(v) => form.setValue('type', Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map((typ) => (
                    <SelectItem key={typ.id} value={String(typ.id)}>
                      {typ.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ch-key'>{t('form.field.key')}</Label>
            <Input id='ch-key' type='password' {...form.register('key')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ch-url'>{t('form.field.base_url')}</Label>
            <Input id='ch-url' placeholder='https://...' {...form.register('base_url')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='ch-models'>{t('form.field.models')}</Label>
            <Textarea id='ch-models' rows={3} {...form.register('models')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='ch-group'>{t('form.field.group')}</Label>
              <Input id='ch-group' {...form.register('group')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-priority'>{t('form.field.priority')}</Label>
              <Input
                id='ch-priority'
                type='number'
                min={0}
                max={100}
                {...form.register('priority', { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('form.cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {t('form.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
