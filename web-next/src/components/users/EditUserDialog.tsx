import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
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
import { useAdminGroups } from '@/hooks/useChannels';
import { fromDisplay, toDisplay, usePublicConfig } from '@/hooks/usePublicConfig';
import { useUserLevels } from '@/hooks/useUserLevels';
import { useUpdateUser, type AdminUser } from '@/hooks/useUsers';
import { ApiError } from '@/lib/api';

// Quick-add presets. Values are in the site's display unit (so a CNY-
// configured site gets ¥1/5/10 chips, a USD one gets $1/5/10, a TOKENS
// one gets 500k/2M chips).
const QUICK_PRESETS_CURRENCY = [1, 5, 10, 50, 100];
const QUICK_PRESETS_TOKENS = [500_000, 2_000_000, 10_000_000];

const schema = z.object({
  display_name: z.string().max(20),
  email: z.string().email().or(z.literal('')),
  group: z.string().max(64),
  level_id: z.number().int().min(0),
  // Display-unit value as a string to preserve user-typed precision.
  quota_display: z
    .string()
    .refine((v) => v === '' || !Number.isNaN(Number(v)), 'not a number')
    .refine((v) => v === '' || Number(v) >= 0, 'must be ≥ 0'),
  password: z.string().max(20),
});
type Values = z.infer<typeof schema>;

export function EditUserDialog({
  open,
  user,
  onOpenChange,
}: {
  open: boolean;
  user: AdminUser;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('users');
  const cfg = usePublicConfig();
  const update = useUpdateUser();
  const adminGroups = useAdminGroups();
  const levels = useUserLevels();

  // Preformat the current balance into display unit with the right digits.
  const currentDisp = toDisplay(user.quota, cfg);
  const currentStr =
    currentDisp.digits === 0
      ? String(currentDisp.value)
      : currentDisp.value.toFixed(currentDisp.digits);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      level_id: user.level_id ?? 0,
      quota_display: currentStr,
      password: '',
    },
  });

  const selectedGroup = useWatch({ control: form.control, name: 'group' });
  const displayInput = useWatch({ control: form.control, name: 'quota_display' }) ?? '';

  useEffect(() => {
    const next = toDisplay(user.quota, cfg);
    const str = next.digits === 0 ? String(next.value) : next.value.toFixed(next.digits);
    form.reset({
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      level_id: user.level_id ?? 0,
      quota_display: str,
      password: '',
    });
  }, [user, cfg, form]);

  const preview = useMemo(() => {
    const parsed = Number(displayInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { raw: null as number | null, delta: null as number | null };
    }
    const raw = fromDisplay(parsed, cfg);
    return { raw, delta: raw - user.quota };
  }, [displayInput, cfg, user.quota]);

  const groupOptions = useMemo(() => {
    const names = new Set((adminGroups.data ?? []).map((group) => group.trim()).filter(Boolean));
    const currentGroup = selectedGroup?.trim();
    const originalGroup = user.group?.trim();
    if (currentGroup) names.add(currentGroup);
    if (originalGroup) names.add(originalGroup);
    if (names.size === 0) names.add('default');
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [adminGroups.data, selectedGroup, user.group]);

  const presets =
    cfg.quota_display_type === 'TOKENS' ? QUICK_PRESETS_TOKENS : QUICK_PRESETS_CURRENCY;

  function applyQuickAdd(amount: number) {
    const current = Number(displayInput);
    const base = Number.isFinite(current) && current >= 0 ? current : 0;
    const summed = base + amount;
    const next =
      currentDisp.digits === 0 ? String(Math.round(summed)) : summed.toFixed(currentDisp.digits);
    form.setValue('quota_display', next, { shouldValidate: true, shouldDirty: true });
  }

  async function onSubmit(values: Values) {
    const parsed = Number(values.quota_display);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error(t('edit.quota_invalid'));
      return;
    }
    const rawQuota = fromDisplay(parsed, cfg);
    try {
      const payload: Parameters<typeof update.mutateAsync>[0] = {
        id: user.id,
        username: user.username,
        display_name: values.display_name,
        email: values.email,
        group: values.group,
        level_id: values.level_id,
        quota: rawQuota,
      };
      if (values.password.trim()) payload.password = values.password.trim();
      await update.mutateAsync(payload);
      toast.success(t('edit.success'));
      onOpenChange(false);
    } catch {
      /* banner */
    }
  }

  function formatPreset(amount: number): string {
    if (cfg.quota_display_type === 'TOKENS') {
      return `+${amount.toLocaleString()}`;
    }
    return `+${currentDisp.symbol}${amount}`;
  }

  function formatDelta(raw: number): string {
    if (raw === 0) return '';
    const disp = toDisplay(Math.abs(raw), cfg);
    const body = disp.digits === 0 ? disp.value.toLocaleString() : disp.value.toFixed(disp.digits);
    const prefix = raw > 0 ? '+' : '-';
    if (cfg.quota_display_type === 'TOKENS') return `${prefix}${body}`;
    return `${prefix}${disp.symbol}${body}`;
  }

  const deltaText =
    preview.delta == null || preview.delta === 0 ? null : formatDelta(preview.delta);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[460px]'>
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
        </DialogHeader>
        {update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='eu-display'>{t('edit.display_name')}</Label>
            <Input id='eu-display' {...form.register('display_name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-email'>{t('edit.email')}</Label>
            <Input id='eu-email' type='email' {...form.register('email')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='eu-group'>{t('edit.group')}</Label>
            <Select
              value={selectedGroup || groupOptions[0]}
              onValueChange={(value) =>
                form.setValue('group', value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id='eu-group' aria-label={t('edit.group')}>
                <SelectValue placeholder={t('edit.group')} />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='eu-level'>{t('edit.level')}</Label>
            <Select
              value={String(form.watch('level_id') ?? 0)}
              onValueChange={(value) =>
                form.setValue('level_id', Number(value), {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id='eu-level' aria-label={t('edit.level')}>
                <SelectValue placeholder={t('edit.level')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='0'>{t('edit.level_none')}</SelectItem>
                {(levels.data ?? []).map((level) => (
                  <SelectItem key={level.id} value={String(level.id)}>
                    {level.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quota block — adapts to the site's quota_display_type */}
          <div className='space-y-2 rounded-md border border-line bg-bg-1 p-3'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='eu-quota' className='text-13'>
                {t('edit.quota')}
              </Label>
              <span className='text-12 text-fg-2 tabular-nums'>
                {t('edit.quota_current', {
                  amount:
                    cfg.quota_display_type === 'TOKENS'
                      ? Number(currentStr).toLocaleString()
                      : `${currentDisp.symbol}${currentStr}`,
                })}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              {cfg.quota_display_type !== 'TOKENS' && (
                <span className='text-14 text-fg-2'>{currentDisp.symbol}</span>
              )}
              <Input
                id='eu-quota'
                type='number'
                min={0}
                step={cfg.quota_display_type === 'TOKENS' ? '1' : '0.01'}
                inputMode='decimal'
                className='tabular-nums'
                {...form.register('quota_display')}
              />
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {presets.map((v) => (
                <button
                  key={v}
                  type='button'
                  onClick={() => applyQuickAdd(v)}
                  className='rounded-sm border border-line px-2 py-0.5 text-12 tabular-nums text-fg-1 hover:border-primary hover:text-fg-0'
                >
                  {formatPreset(v)}
                </button>
              ))}
              <button
                type='button'
                onClick={() => {
                  form.setValue('quota_display', currentStr, {
                    shouldDirty: false,
                    shouldValidate: true,
                  });
                }}
                className='ml-auto rounded-sm px-2 py-0.5 text-12 text-fg-2 hover:text-fg-0'
              >
                {t('edit.quota_reset')}
              </button>
            </div>
            {deltaText && (
              <p className='text-12 tabular-nums text-fg-2'>
                {t('edit.quota_preview', {
                  delta: deltaText,
                  raw: preview.raw?.toLocaleString() ?? '—',
                })}
              </p>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='eu-password'>{t('edit.password')}</Label>
            <Input id='eu-password' type='password' {...form.register('password')} />
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('create.cancel')}
            </Button>
            <Button type='submit' disabled={update.isPending}>
              {t('edit.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
