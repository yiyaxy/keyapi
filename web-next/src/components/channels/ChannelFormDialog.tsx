import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { JsonEditor } from '@/components/common/JsonEditor';
import { KeyValueEditor } from '@/components/common/KeyValueEditor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  useAdminGroups,
  useChannelTypeModels,
  useCreateChannel,
  useUpdateChannel,
  type Channel,
  type ChannelInput,
} from '@/hooks/useChannels';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { CHANNEL_TYPES } from '@/lib/channelTypes';

// Channel.Setting is a JSON blob (dto.ChannelSettings). We surface a few
// first-class keys (proxy, system_prompt) while preserving anything else
// the backend stored — so round-tripping never loses
// channel_ratio / virtual_cache_* / force_format etc.
type SettingJson = {
  proxy?: string;
  system_prompt?: string;
  [key: string]: unknown;
};

function parseSetting(raw: string | null): SettingJson {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SettingJson) : {};
  } catch {
    return {};
  }
}

function buildSetting(original: SettingJson, proxy: string, systemPrompt: string): string {
  const merged: SettingJson = { ...original };
  if (proxy) merged.proxy = proxy;
  else delete merged.proxy;
  if (systemPrompt) merged.system_prompt = systemPrompt;
  else delete merged.system_prompt;
  return Object.keys(merged).length === 0 ? '' : JSON.stringify(merged);
}

// JSON-flavoured textarea validator. Accepts empty string; otherwise
// must parse as JSON. Avoids a dependency — the server re-validates
// anyway; this only catches obvious fat-finger mistakes.
const jsonString = z.string().refine((s) => {
  if (s.trim() === '') return true;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}, 'invalid JSON');

const schema = z.object({
  // basics
  name: z.string().min(1).max(60),
  type: z.number().int().min(0),
  key: z.string(),
  base_url: z.string(),
  models: z.string(),
  group: z.string().min(1),
  priority: z.number().int().min(-999).max(999),
  weight: z.number().int().min(0),
  openai_organization: z.string(),
  proxy: z.string(),
  system_prompt: z.string(),
  // routing / reliability
  test_model: z.string(),
  model_mapping: jsonString,
  status_code_mapping: jsonString,
  max_retry: z.number().int().min(0).max(10),
  auto_ban: z.boolean(),
  // advanced
  param_override: jsonString,
  header_override: jsonString,
  tag: z.string(),
  remark: z.string().max(255),
  // create-only: how to interpret `key`
  mode: z.enum(['single', 'batch', 'multi_to_single']),
  multi_key_mode: z.enum(['polling', 'random']),
  batch_add_set_key_prefix_2_name: z.boolean(),
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
  weight: 0,
  openai_organization: '',
  proxy: '',
  system_prompt: '',
  test_model: '',
  model_mapping: '',
  status_code_mapping: '',
  max_retry: 0,
  auto_ban: true,
  param_override: '',
  header_override: '',
  tag: '',
  remark: '',
  mode: 'single',
  multi_key_mode: 'polling',
  batch_add_set_key_prefix_2_name: false,
};

function fromChannel(ch: Channel): Values {
  const setting = parseSetting(ch.setting);
  return {
    name: ch.name,
    type: ch.type,
    key: '',
    base_url: ch.base_url ?? '',
    models: ch.models,
    group: ch.group,
    priority: ch.priority ?? 0,
    weight: ch.weight ?? 0,
    openai_organization: ch.openai_organization ?? '',
    proxy: typeof setting.proxy === 'string' ? setting.proxy : '',
    system_prompt: typeof setting.system_prompt === 'string' ? setting.system_prompt : '',
    test_model: ch.test_model ?? '',
    model_mapping: ch.model_mapping ?? '',
    status_code_mapping: ch.status_code_mapping ?? '',
    max_retry: ch.max_retry ?? 0,
    auto_ban: (ch.auto_ban ?? 1) !== 0,
    param_override: ch.param_override ?? '',
    header_override: ch.header_override ?? '',
    tag: ch.tag ?? '',
    remark: ch.remark ?? '',
    // Edit path ignores these — they only apply on create.
    mode: 'single',
    multi_key_mode: 'polling',
    batch_add_set_key_prefix_2_name: false,
  };
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='rounded-md border border-line bg-bg-1'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='flex w-full items-center justify-between px-3 py-2 text-13 font-medium text-fg-0'
      >
        <span>{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className='space-y-3 border-t border-line px-3 py-3'>{children}</div>}
    </div>
  );
}

// ModelPicker renders a search + chip grid below the models textarea.
// Suggestions are scoped to the currently-selected channel type; empty
// type map falls back to a flat union so the user still gets something.
// Click a chip to toggle the model in the CSV — the textarea stays
// authoritative so power users can still edit directly.
function ModelPicker({
  typeId,
  all,
  value,
  onChange,
  search,
  onSearchChange,
  label,
  searchPlaceholder,
  emptyLabel,
}: {
  typeId: number;
  all: Record<string, string[]>;
  value: string;
  onChange: (v: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  label: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const selected = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selectedSet = new Set(selected);
  const scoped = all[String(typeId)];
  const pool =
    scoped && scoped.length > 0
      ? scoped
      : Array.from(new Set(Object.values(all).flat())).sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  const suggestions = (needle ? pool.filter((m) => m.toLowerCase().includes(needle)) : pool).slice(
    0,
    200
  );
  const toggle = (m: string) => {
    if (selectedSet.has(m)) {
      onChange(selected.filter((x) => x !== m).join(','));
    } else {
      onChange([...selected, m].join(','));
    }
  };

  if (pool.length === 0) return null;
  return (
    <div className='space-y-2 rounded-md border border-line bg-bg-0 p-2'>
      <div className='flex items-center gap-2'>
        <Label className='text-12 text-fg-2'>{label}</Label>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className='h-7 flex-1 text-12'
        />
      </div>
      <div className='max-h-44 overflow-y-auto'>
        {suggestions.length === 0 ? (
          <p className='px-1 py-2 text-12 text-fg-2'>{emptyLabel}</p>
        ) : (
          <div className='flex flex-wrap gap-1'>
            {suggestions.map((m) => {
              const active = selectedSet.has(m);
              return (
                <button
                  key={m}
                  type='button'
                  onClick={() => toggle(m)}
                  className={
                    'rounded-full border px-2 py-0.5 text-11 transition-colors ' +
                    (active
                      ? 'border-fg-0 bg-fg-0 text-bg-0'
                      : 'border-line bg-bg-1 text-fg-2 hover:text-fg-0')
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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
  const { user } = useAuth();
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const adminGroups = useAdminGroups();
  const channelTypeModels = useChannelTypeModels();
  const isEdit = Boolean(channel);
  const tenantView = !(user && Math.max(user.role, user.platform_role) >= 100);
  const [modelSearch, setModelSearch] = useState('');

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: channel ? fromChannel(channel) : EMPTY,
  });

  useEffect(() => {
    form.reset(channel ? fromChannel(channel) : EMPTY);
  }, [channel, form]);

  async function onSubmit(values: Values) {
    const originalSetting = parseSetting(channel?.setting ?? null);
    const settingJson = buildSetting(originalSetting, values.proxy.trim(), values.system_prompt);

    // Build the write payload. On edit we omit `key` unless the admin
    // typed a new one — the backend treats empty key as "keep existing".
    const payload: ChannelInput = {
      name: values.name,
      type: values.type,
      base_url: values.base_url || undefined,
      models: values.models,
      group: values.group,
      priority: values.priority,
      weight: values.weight,
      openai_organization: values.openai_organization || undefined,
      test_model: values.test_model || undefined,
      model_mapping: values.model_mapping || undefined,
      status_code_mapping: values.status_code_mapping || undefined,
      max_retry: values.max_retry,
      auto_ban: values.auto_ban ? 1 : 0,
      param_override: values.param_override || undefined,
      header_override: values.header_override || undefined,
      tag: values.tag || undefined,
      remark: values.remark || undefined,
      setting: settingJson || undefined,
    };

    try {
      if (channel) {
        const updatePayload: Parameters<typeof update.mutateAsync>[0] = {
          input: {
            ...payload,
            id: channel.id,
          },
          tenantView,
        };
        if (values.key.trim()) updatePayload.input.key = values.key.trim();
        await update.mutateAsync(updatePayload);
      } else {
        await create.mutateAsync({
          input: { ...payload, key: values.key },
          opts: {
            mode: values.mode,
            multi_key_mode: values.multi_key_mode,
            batch_add_set_key_prefix_2_name: values.batch_add_set_key_prefix_2_name,
          },
          tenantView,
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
      <DialogContent className='max-h-[90vh] max-w-[620px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'form.edit_title' : 'form.create_title')}</DialogTitle>
        </DialogHeader>
        {mutation.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={mutation.error.backendMessage ?? mutation.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-3'>
          {/* Basics */}
          <Section title={t('form.section.basic')}>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='ch-name'>{t('form.field.name')}</Label>
                <Input id='ch-name' {...form.register('name')} />
              </div>
              <div className='space-y-2'>
                <Label>{t('form.field.type')}</Label>
                <Select
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
            {!isEdit && (
              <div className='space-y-2 rounded-md border border-line bg-bg-0 p-3'>
                <Label>{t('form.field.mode')}</Label>
                <Select
                  value={form.watch('mode')}
                  onValueChange={(v) =>
                    form.setValue('mode', v as 'single' | 'batch' | 'multi_to_single')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='single'>{t('form.field.mode.single')}</SelectItem>
                    <SelectItem value='batch'>{t('form.field.mode.batch')}</SelectItem>
                    <SelectItem value='multi_to_single'>
                      {t('form.field.mode.multi_to_single')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className='text-12 text-fg-2'>
                  {t(`form.field.mode.${form.watch('mode')}.hint`)}
                </p>
                {form.watch('mode') === 'batch' && (
                  <div className='flex items-center gap-2 pt-1'>
                    <Switch
                      id='ch-batch-prefix'
                      checked={form.watch('batch_add_set_key_prefix_2_name')}
                      onCheckedChange={(v) => form.setValue('batch_add_set_key_prefix_2_name', v)}
                    />
                    <Label htmlFor='ch-batch-prefix'>
                      {t('form.field.batch_add_set_key_prefix_2_name')}
                    </Label>
                  </div>
                )}
                {form.watch('mode') === 'multi_to_single' && (
                  <div className='space-y-2 pt-1'>
                    <Label>{t('form.field.multi_key_mode')}</Label>
                    <Select
                      value={form.watch('multi_key_mode')}
                      onValueChange={(v) =>
                        form.setValue('multi_key_mode', v as 'polling' | 'random')
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='polling'>
                          {t('form.field.multi_key_mode.polling')}
                        </SelectItem>
                        <SelectItem value='random'>
                          {t('form.field.multi_key_mode.random')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <div className='space-y-2'>
              <Label htmlFor='ch-key'>
                {t('form.field.key')}
                {isEdit && (
                  <span className='ml-2 text-12 text-fg-2'>{t('form.field.key_hint_edit')}</span>
                )}
              </Label>
              {!isEdit && form.watch('mode') !== 'single' ? (
                <>
                  <Textarea id='ch-key' rows={5} {...form.register('key')} />
                  <p className='text-12 text-fg-2'>{t('form.field.key_hint_multi')}</p>
                </>
              ) : (
                <Input id='ch-key' type='password' {...form.register('key')} />
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-url'>{t('form.field.base_url')}</Label>
              <Input id='ch-url' placeholder='https://...' {...form.register('base_url')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-proxy'>{t('form.field.proxy')}</Label>
              <Input
                id='ch-proxy'
                placeholder='http://user:pass@host:port'
                {...form.register('proxy')}
              />
              <p className='text-12 text-fg-2'>{t('form.field.proxy_hint')}</p>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='ch-group'>{t('form.field.group')}</Label>
                <Input id='ch-group' {...form.register('group')} />
                {(adminGroups.data?.length ?? 0) > 0 && (
                  <div className='flex flex-wrap gap-1'>
                    {adminGroups.data!.map((g) => {
                      const current = form
                        .watch('group')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const active = current.includes(g);
                      return (
                        <button
                          key={g}
                          type='button'
                          onClick={() => {
                            const next = active ? current.filter((x) => x !== g) : [...current, g];
                            form.setValue('group', next.join(',') || 'default', {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                          className={
                            'rounded-full border px-2 py-0.5 text-11 transition-colors ' +
                            (active
                              ? 'border-fg-0 bg-fg-0 text-bg-0'
                              : 'border-line bg-bg-1 text-fg-2 hover:text-fg-0')
                          }
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className='text-12 text-fg-2'>{t('form.field.group_hint')}</p>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ch-tag'>{t('form.field.tag')}</Label>
                <Input id='ch-tag' {...form.register('tag')} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ch-priority'>{t('form.field.priority')}</Label>
                <Input
                  id='ch-priority'
                  type='number'
                  {...form.register('priority', { valueAsNumber: true })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ch-weight'>{t('form.field.weight')}</Label>
                <Input
                  id='ch-weight'
                  type='number'
                  min={0}
                  {...form.register('weight', { valueAsNumber: true })}
                />
              </div>
            </div>
          </Section>

          {/* Models */}
          <Section title={t('form.section.models')}>
            <div className='space-y-2'>
              <Label htmlFor='ch-models'>{t('form.field.models')}</Label>
              <Textarea id='ch-models' rows={3} {...form.register('models')} />
              <p className='text-12 text-fg-2'>{t('form.field.models_hint')}</p>
              <ModelPicker
                typeId={form.watch('type')}
                all={channelTypeModels.data ?? {}}
                value={form.watch('models')}
                onChange={(v) =>
                  form.setValue('models', v, { shouldDirty: true, shouldValidate: true })
                }
                search={modelSearch}
                onSearchChange={setModelSearch}
                label={t('form.field.models_picker')}
                searchPlaceholder={t('form.field.models_picker_search')}
                emptyLabel={t('form.field.models_picker_empty')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-test-model'>{t('form.field.test_model')}</Label>
              <Input id='ch-test-model' {...form.register('test_model')} />
            </div>
            <div className='space-y-2'>
              <Label>{t('form.field.model_mapping')}</Label>
              <KeyValueEditor
                value={form.watch('model_mapping')}
                onChange={(v) =>
                  form.setValue('model_mapping', v, { shouldValidate: true, shouldDirty: true })
                }
                keyPlaceholder='gpt-4-1106-preview'
                valuePlaceholder='gpt-4o'
              />
              <p className='text-12 text-fg-2'>{t('form.field.model_mapping_hint')}</p>
            </div>
          </Section>

          {/* Reliability */}
          <Section title={t('form.section.reliability')} defaultOpen={false}>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='ch-retry'>{t('form.field.max_retry')}</Label>
                <Input
                  id='ch-retry'
                  type='number'
                  min={0}
                  max={10}
                  {...form.register('max_retry', { valueAsNumber: true })}
                />
              </div>
              <div className='flex items-center gap-2 pt-6'>
                <Switch
                  id='ch-autoban'
                  checked={form.watch('auto_ban')}
                  onCheckedChange={(v) => form.setValue('auto_ban', v)}
                />
                <Label htmlFor='ch-autoban'>{t('form.field.auto_ban')}</Label>
              </div>
            </div>
            <div className='space-y-2'>
              <Label>{t('form.field.status_code_mapping')}</Label>
              <KeyValueEditor
                value={form.watch('status_code_mapping')}
                onChange={(v) =>
                  form.setValue('status_code_mapping', v, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                keyPlaceholder='500'
                valuePlaceholder='503'
              />
              <p className='text-12 text-fg-2'>{t('form.field.status_code_mapping_hint')}</p>
            </div>
          </Section>

          {/* Advanced */}
          <Section title={t('form.section.advanced')} defaultOpen={false}>
            <div className='space-y-2'>
              <Label htmlFor='ch-org'>{t('form.field.openai_organization')}</Label>
              <Input id='ch-org' {...form.register('openai_organization')} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-sys'>{t('form.field.system_prompt')}</Label>
              <Textarea id='ch-sys' rows={3} {...form.register('system_prompt')} />
            </div>
            <div className='space-y-2'>
              <Label>{t('form.field.param_override')}</Label>
              <JsonEditor
                value={form.watch('param_override')}
                onChange={(v) =>
                  form.setValue('param_override', v, { shouldValidate: true, shouldDirty: true })
                }
                rows={4}
                placeholder='{\n  "temperature": 0.7\n}'
              />
              <p className='text-12 text-fg-2'>{t('form.field.param_override_hint')}</p>
            </div>
            <div className='space-y-2'>
              <Label>{t('form.field.header_override')}</Label>
              <KeyValueEditor
                value={form.watch('header_override')}
                onChange={(v) =>
                  form.setValue('header_override', v, { shouldValidate: true, shouldDirty: true })
                }
                keyPlaceholder='X-Custom-Header'
                valuePlaceholder='value'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ch-remark'>{t('form.field.remark')}</Label>
              <Textarea id='ch-remark' rows={2} {...form.register('remark')} />
            </div>
          </Section>

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
