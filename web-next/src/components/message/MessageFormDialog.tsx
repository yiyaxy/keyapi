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
  MESSAGE_TYPE,
  useCreateMessage,
  useEditMessage,
  type AdminMessage,
} from '@/hooks/useMessages';
import { ApiError } from '@/lib/api';

const schema = z
  .object({
    title: z.string().min(1).max(255),
    content: z.string().min(1),
    type: z.number().int().min(1).max(2),
    target_user_id: z.number().int().min(0),
  })
  .refine((v) => v.type !== MESSAGE_TYPE.DIRECTED || v.target_user_id > 0, {
    path: ['target_user_id'],
    message: 'directed message must specify a user',
  });
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  title: '',
  content: '',
  type: MESSAGE_TYPE.BROADCAST,
  target_user_id: 0,
};

function fromRecord(r: AdminMessage): Values {
  return {
    title: r.title,
    content: r.content,
    type: r.type,
    target_user_id: r.target_user_id,
  };
}

export function MessageFormDialog({
  open,
  record,
  onOpenChange,
}: {
  open: boolean;
  record: AdminMessage | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('message');
  const create = useCreateMessage();
  const edit = useEditMessage();
  const isEdit = Boolean(record);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: record ? fromRecord(record) : EMPTY,
  });

  useEffect(() => {
    form.reset(record ? fromRecord(record) : EMPTY);
  }, [record, form]);

  async function onSubmit(values: Values) {
    try {
      if (record) {
        await edit.mutateAsync({
          id: record.id,
          title: values.title,
          content: values.content,
        });
        toast.success(t('toast.update.success'));
      } else {
        await create.mutateAsync(values);
        toast.success(t('toast.create.success'));
      }
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  const mutation = isEdit ? edit : create;
  // eslint-disable-next-line react-hooks/incompatible-library
  const currentType = form.watch('type');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('form.title.edit') : t('form.title.create')}
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
            <Label htmlFor='m-title'>{t('form.title_field.label')}</Label>
            <Input id='m-title' autoFocus {...form.register('title')} />
            {form.formState.errors.title && (
              <p className='text-12 text-danger'>{t('form.validate.title')}</p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='m-content'>{t('form.content.label')}</Label>
            <Textarea
              id='m-content'
              rows={6}
              placeholder={t('form.content.placeholder')}
              {...form.register('content')}
            />
            {form.formState.errors.content && (
              <p className='text-12 text-danger'>{t('form.validate.content')}</p>
            )}
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label>{t('form.type.label')}</Label>
              <Select
                value={String(currentType)}
                onValueChange={(v) => form.setValue('type', Number(v))}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={String(MESSAGE_TYPE.BROADCAST)}>
                    {t('type.broadcast')}
                  </SelectItem>
                  <SelectItem value={String(MESSAGE_TYPE.DIRECTED)}>
                    {t('type.directed')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='m-target'>{t('form.target.label')}</Label>
              <Input
                id='m-target'
                type='number'
                min={0}
                disabled={isEdit || currentType !== MESSAGE_TYPE.DIRECTED}
                {...form.register('target_user_id', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.target.help')}</p>
              {form.formState.errors.target_user_id && (
                <p className='text-12 text-danger'>
                  {t('form.validate.target')}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='secondary'
              onClick={() => onOpenChange(false)}
            >
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
