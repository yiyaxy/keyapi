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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreatePromptRule,
  useUpdatePromptRule,
  type PromptRule,
} from '@/hooks/usePromptRules';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(100),
  type: z.number().int().min(1).max(4),
  keyword: z.string().min(1),
  replacement: z.string(),
  channel_id: z.number().int().min(0),
  priority: z.number().int(),
  enabled: z.boolean(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  name: '',
  type: 1,
  keyword: '',
  replacement: '',
  channel_id: 0,
  priority: 0,
  enabled: true,
};

function fromRecord(r: PromptRule): Values {
  return {
    name: r.name,
    type: r.type,
    keyword: r.keyword,
    replacement: r.replacement,
    channel_id: r.channel_id,
    priority: r.priority,
    enabled: r.enabled,
  };
}

export function PromptRuleFormDialog({
  open,
  record,
  onOpenChange,
}: {
  open: boolean;
  record: PromptRule | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('prompt');
  const create = useCreatePromptRule();
  const update = useUpdatePromptRule();
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
      ...values,
      rewrite_channel_id: record?.rewrite_channel_id ?? 0,
      rewrite_model: record?.rewrite_model ?? '',
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
  // eslint-disable-next-line react-hooks/incompatible-library
  const currentType = form.watch('type');
  const typeLocked = isEdit && record ? record.type > 2 : false;

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
            <Label htmlFor='p-name'>{t('form.name.label')}</Label>
            <Input id='p-name' autoFocus {...form.register('name')} />
            {form.formState.errors.name && (
              <p className='text-12 text-danger'>{t('form.validate.name')}</p>
            )}
          </div>
          <div className='space-y-2'>
            <Label>{t('form.type.label')}</Label>
            <Select
              value={String(currentType)}
              onValueChange={(v) => form.setValue('type', Number(v))}
              disabled={typeLocked}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1'>{t('type.replace')}</SelectItem>
                <SelectItem value='2'>{t('type.keyword')}</SelectItem>
                {typeLocked && (
                  <>
                    <SelectItem value='3'>{t('type.response')}</SelectItem>
                    <SelectItem value='4'>{t('type.rewrite')}</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <p className='text-12 text-fg-2'>
              {typeLocked ? t('form.type.locked') : t('form.type.create_help')}
            </p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-keyword'>{t('form.keyword.label')}</Label>
            <Textarea
              id='p-keyword'
              rows={3}
              placeholder={t('form.keyword.placeholder')}
              {...form.register('keyword')}
            />
            {form.formState.errors.keyword && (
              <p className='text-12 text-danger'>{t('form.validate.keyword')}</p>
            )}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-repl'>{t('form.replacement.label')}</Label>
            <Textarea
              id='p-repl'
              rows={3}
              placeholder={t('form.replacement.placeholder')}
              {...form.register('replacement')}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='p-chan'>{t('form.channel.label')}</Label>
              <Input
                id='p-chan'
                type='number'
                min={0}
                {...form.register('channel_id', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.channel.help')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='p-prio'>{t('form.priority.label')}</Label>
              <Input
                id='p-prio'
                type='number'
                {...form.register('priority', { valueAsNumber: true })}
              />
              <p className='text-12 text-fg-2'>{t('form.priority.help')}</p>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Switch
              id='p-enabled'
              checked={form.watch('enabled')}
              onCheckedChange={(v) => form.setValue('enabled', v)}
            />
            <Label htmlFor='p-enabled'>{t('form.enabled.label')}</Label>
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
