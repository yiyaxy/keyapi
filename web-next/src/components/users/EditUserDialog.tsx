import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateUser, type AdminUser } from '@/hooks/useUsers';
import { ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000;
const QUICK_TOPUPS = [1, 5, 10, 50, 100]; // USD

// Admin-side edit. Quota is handled in two complementary lanes:
//   - "Set to" — absolute value in USD (drives the final quota payload)
//   - "Quick add" — buttons that bump the "Set to" field by +$N
// The raw quota number is computed on submit and sent to the backend
// unchanged, so the wire format stays byte-identical to what the old
// form produced.
const schema = z.object({
  display_name: z.string().max(20),
  email: z.string().email().or(z.literal('')),
  group: z.string().max(64),
  // quota_usd is stored as a stringified decimal to preserve the user's
  // typed precision (avoids 9.999999 drift from float round-trips).
  quota_usd: z
    .string()
    .refine((v) => v === '' || !Number.isNaN(Number(v)), 'not a number')
    .refine((v) => v === '' || Number(v) >= 0, 'must be ≥ 0'),
  password: z.string().max(20),
});
type Values = z.infer<typeof schema>;

function quotaToUsd(raw: number): string {
  return (raw / QUOTA_PER_UNIT).toFixed(2);
}

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
  const update = useUpdateUser();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      quota_usd: quotaToUsd(user.quota),
      password: '',
    },
  });

  // Keep this in sync with the form so quick-add / preview can read it
  // without triggering a re-render cascade on every keystroke.
  const [quotaUsdInput, setQuotaUsdInput] = useState(quotaToUsd(user.quota));

  useEffect(() => {
    form.reset({
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      group: user.group ?? 'default',
      quota_usd: quotaToUsd(user.quota),
      password: '',
    });
    setQuotaUsdInput(quotaToUsd(user.quota));
  }, [user, form]);

  // Computed preview values — recomputed on every quotaUsdInput change.
  const preview = useMemo(() => {
    const parsed = Number(quotaUsdInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { usd: null as number | null, raw: null as number | null, delta: null as number | null };
    }
    const raw = Math.round(parsed * QUOTA_PER_UNIT);
    return {
      usd: parsed,
      raw,
      delta: raw - user.quota,
    };
  }, [quotaUsdInput, user.quota]);

  function applyQuickAdd(usd: number) {
    const current = Number(quotaUsdInput);
    const base = Number.isFinite(current) && current >= 0 ? current : 0;
    const next = (base + usd).toFixed(2);
    setQuotaUsdInput(next);
    form.setValue('quota_usd', next, { shouldValidate: true, shouldDirty: true });
  }

  async function onSubmit(values: Values) {
    const parsed = Number(values.quota_usd);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error(t('edit.quota_invalid'));
      return;
    }
    const rawQuota = Math.round(parsed * QUOTA_PER_UNIT);
    try {
      const payload: Parameters<typeof update.mutateAsync>[0] = {
        id: user.id,
        username: user.username,
        display_name: values.display_name,
        email: values.email,
        group: values.group,
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

  const currentUsd = quotaToUsd(user.quota);
  const deltaText =
    preview.delta == null
      ? null
      : preview.delta === 0
        ? null
        : preview.delta > 0
          ? `+${fmtMoney(preview.delta / QUOTA_PER_UNIT)}`
          : `-${fmtMoney(Math.abs(preview.delta) / QUOTA_PER_UNIT)}`;

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
            <Input id='eu-group' {...form.register('group')} />
          </div>

          {/* Quota block — friendly USD input + quick-add buttons + preview */}
          <div className='space-y-2 rounded-md border border-line bg-bg-1 p-3'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor='eu-quota' className='text-13'>
                {t('edit.quota')}
              </Label>
              <span className='text-12 text-fg-2 tabular-nums'>
                {t('edit.quota_current', { amount: currentUsd })}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-14 text-fg-2'>$</span>
              <Input
                id='eu-quota'
                type='number'
                min={0}
                step='0.01'
                inputMode='decimal'
                className='tabular-nums'
                {...form.register('quota_usd', {
                  onChange: (e) => setQuotaUsdInput(e.target.value),
                })}
              />
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {QUICK_TOPUPS.map((v) => (
                <button
                  key={v}
                  type='button'
                  onClick={() => applyQuickAdd(v)}
                  className='rounded-sm border border-line px-2 py-0.5 text-12 tabular-nums text-fg-1 hover:border-primary hover:text-fg-0'
                >
                  +${v}
                </button>
              ))}
              <button
                type='button'
                onClick={() => {
                  setQuotaUsdInput(currentUsd);
                  form.setValue('quota_usd', currentUsd, {
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
