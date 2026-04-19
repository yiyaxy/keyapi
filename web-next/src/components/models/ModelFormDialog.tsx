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
import { useCreateModelMeta, useUpdateModelMeta, type ModelMeta } from '@/hooks/useModelsMeta';
import { ApiError } from '@/lib/api';

const schema = z.object({
  model_name: z.string().min(1).max(128),
  description: z.string().max(2000),
  icon: z.string().max(128),
  tags: z.string().max(255),
  endpoints: z.string().max(1000),
  status: z.number().int(),
});
type Values = z.infer<typeof schema>;

function fromModel(m: ModelMeta): Values {
  return {
    model_name: m.model_name,
    description: m.description ?? '',
    icon: m.icon ?? '',
    tags: m.tags ?? '',
    endpoints: m.endpoints ?? '',
    status: m.status ?? 1,
  };
}

const EMPTY: Values = {
  model_name: '',
  description: '',
  icon: '',
  tags: '',
  endpoints: '',
  status: 1,
};

export function ModelFormDialog({
  open,
  model,
  onOpenChange,
}: {
  open: boolean;
  model: ModelMeta | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('models');
  const create = useCreateModelMeta();
  const update = useUpdateModelMeta();
  const isEdit = Boolean(model);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: model ? fromModel(model) : EMPTY,
  });

  useEffect(() => {
    form.reset(model ? fromModel(model) : EMPTY);
  }, [model, form]);

  async function onSubmit(values: Values) {
    try {
      if (model) {
        await update.mutateAsync({ ...values, id: model.id });
      } else {
        await create.mutateAsync(values);
      }
      toast.success(t('form.saved'));
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
          <DialogTitle>
            {isEdit ? t('form.edit_title', { name: model?.model_name }) : t('form.create_title')}
          </DialogTitle>
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
            <Label htmlFor='m-name'>{t('form.model_name')}</Label>
            <Input id='m-name' autoFocus disabled={isEdit} {...form.register('model_name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='m-desc'>{t('form.description')}</Label>
            <Textarea id='m-desc' rows={3} {...form.register('description')} />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='m-icon'>{t('form.icon')}</Label>
              <Input id='m-icon' {...form.register('icon')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='m-tags'>{t('form.tags')}</Label>
              <Input id='m-tags' {...form.register('tags')} />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='m-endpoints'>{t('form.endpoints')}</Label>
            <Input id='m-endpoints' {...form.register('endpoints')} />
          </div>
          <div className='space-y-2'>
            <Label>{t('form.status')}</Label>
            <Select
              // eslint-disable-next-line react-hooks/incompatible-library
              value={String(form.watch('status'))}
              onValueChange={(v) => form.setValue('status', Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1'>{t('status.enabled')}</SelectItem>
                <SelectItem value='2'>{t('status.disabled')}</SelectItem>
              </SelectContent>
            </Select>
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
