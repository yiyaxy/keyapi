import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
  useUpdateTenantPlan,
  type TenantPlan,
  type UpdateTenantPlanPayload,
} from '@/hooks/usePlatformTenants';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import {
  fmtDisplay,
  rawToUnit,
  unitSymbol,
  unitToRaw,
  type QuotaUnit,
} from '@/lib/format';

// Section = collapsible group used on the channel form and here.
// Inlined (not extracted) because the channel-form version lives in a
// different folder and re-exporting would cross a domain boundary.
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

function unixToLocalInput(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const d = new Date(seconds * 1000);
  // datetime-local wants YYYY-MM-DDTHH:mm in the user's local timezone;
  // chop the seconds + tz suffix from toISOString (which is UTC) won't
  // round-trip, so build from local parts instead.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToUnix(local: string): number {
  if (!local) return 0;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

// fmtCapNumber: 格式化任意单位的浮点数字（USD/CNY/custom）成干净字符串。
// 用于输入框派生值和等价预览：避免科学记数法和尾零噪音（0.100000 → 0.1）。
function fmtCapNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1) return Number(n.toFixed(2)).toString();
  return Number(n.toFixed(6)).toString();
}

type FormState = {
  plan_name: string;
  quota_limit: string;
  rpm_limit: string;
  tpm_limit: string;
  max_members: string;
  max_tokens: string;
  max_channels: string;
  allowed_models: string;
  status: boolean;
  expires_at_local: string;
  grace_period_seconds: string;
  renew_period_days: string;
  renew_price_yuan: string;
  renew_currency: string;
  platform_quota_cap: string;
  platform_quota_period: 'none' | 'daily' | 'monthly';
};

function fromPlan(plan: TenantPlan): FormState {
  return {
    plan_name: plan.plan_name,
    quota_limit: String(plan.quota_limit),
    rpm_limit: String(plan.rpm_limit),
    tpm_limit: String(plan.tpm_limit),
    max_members: String(plan.max_members),
    max_tokens: String(plan.max_tokens),
    max_channels: String(plan.max_channels),
    allowed_models: plan.allowed_models,
    status: plan.status === 1,
    expires_at_local: unixToLocalInput(plan.expires_at),
    grace_period_seconds: String(plan.grace_period_seconds),
    renew_period_days: String(plan.renew_period_days),
    renew_price_yuan: (plan.renew_price_amount / 100).toFixed(2),
    renew_currency: plan.renew_currency || 'CNY',
    platform_quota_cap: String(plan.platform_quota_cap),
    platform_quota_period: plan.platform_quota_period,
  };
}

export function TenantPlanEditorDialog({
  open,
  tenantName,
  plan,
  onOpenChange,
}: {
  open: boolean;
  tenantName: string;
  plan: TenantPlan;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const cfg = usePublicConfig();
  const update = useUpdateTenantPlan();
  const [form, setForm] = useState<FormState>(() => fromPlan(plan));

  // capUnit / capText 配合 form.platform_quota_cap（raw quota string）做"多单位输入"。
  // - form.platform_quota_cap 永远是 raw quota 字符串，保存直传后端
  // - capText 是输入框当前显示的字面量（跟 capUnit 一致）
  // - 切 unit 时从 raw 派生回 text；输入时按当前 unit 解析回 raw
  const [capUnit, setCapUnit] = useState<QuotaUnit>('quota');
  const [capText, setCapText] = useState<string>(() => fromPlan(plan).platform_quota_cap);

  useEffect(() => {
    setForm(fromPlan(plan));
    setCapUnit('quota');
    setCapText(fromPlan(plan).platform_quota_cap);
  }, [plan]);

  function patch<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // Parse once; also drives a preview of the renewal price.
  const renewYuan = Number(form.renew_price_yuan);
  const renewCents = Number.isFinite(renewYuan) && renewYuan >= 0 ? Math.round(renewYuan * 100) : 0;

  const renewEnabled = useMemo(() => renewCents > 0, [renewCents]);

  async function onSave() {
    const body: UpdateTenantPlanPayload = {
      plan_name: form.plan_name,
      quota_limit: Number(form.quota_limit),
      rpm_limit: Number(form.rpm_limit),
      tpm_limit: Number(form.tpm_limit),
      max_members: Number(form.max_members),
      max_tokens: Number(form.max_tokens),
      max_channels: Number(form.max_channels),
      allowed_models: form.allowed_models,
      status: form.status ? 1 : 0,
      expires_at: localInputToUnix(form.expires_at_local),
      grace_period_seconds: Number(form.grace_period_seconds),
      renew_period_days: Number(form.renew_period_days),
      renew_price_amount: renewCents,
      renew_currency: form.renew_currency || 'CNY',
      platform_quota_cap: Number(form.platform_quota_cap),
      platform_quota_period: form.platform_quota_period,
    };
    // NaN guard — any bad numeric drops to defaults server-side if we omit
    // the field, but here we'd rather surface "fix your input" than
    // silently overwrite with 0 / NaN.
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        toast.error(t('plan.error.invalid_number', { field: k }));
        return;
      }
    }
    try {
      await update.mutateAsync({ id: plan.tenant_id, body });
      toast.success(t('plan.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-[620px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{t('plan.title', { name: tenantName })}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <Section title={t('plan.section.basic')}>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.plan_name')}</Label>
                <Input value={form.plan_name} onChange={(e) => patch('plan_name', e.target.value)} />
              </div>
              <div className='flex items-end gap-2'>
                <div className='flex items-center gap-2 pt-6'>
                  <Switch
                    checked={form.status}
                    onCheckedChange={(v) => patch('status', v)}
                  />
                  <Label>{t('plan.field.status_active')}</Label>
                </div>
              </div>
            </div>
          </Section>

          <Section title={t('plan.section.limits')}>
            <p className='text-12 text-fg-2'>{t('plan.hint.unlimited')}</p>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.quota_limit')}</Label>
                <Input
                  type='number'
                  value={form.quota_limit}
                  onChange={(e) => patch('quota_limit', e.target.value)}
                  className='tabular-nums'
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.rpm_limit')}</Label>
                <Input
                  type='number'
                  value={form.rpm_limit}
                  onChange={(e) => patch('rpm_limit', e.target.value)}
                  className='tabular-nums'
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.tpm_limit')}</Label>
                <Input
                  type='number'
                  value={form.tpm_limit}
                  onChange={(e) => patch('tpm_limit', e.target.value)}
                  className='tabular-nums'
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.max_members')}</Label>
                <Input
                  type='number'
                  value={form.max_members}
                  onChange={(e) => patch('max_members', e.target.value)}
                  className='tabular-nums'
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.max_tokens')}</Label>
                <Input
                  type='number'
                  value={form.max_tokens}
                  onChange={(e) => patch('max_tokens', e.target.value)}
                  className='tabular-nums'
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.max_channels')}</Label>
                <Input
                  type='number'
                  value={form.max_channels}
                  onChange={(e) => patch('max_channels', e.target.value)}
                  className='tabular-nums'
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label>{t('plan.field.allowed_models')}</Label>
              <Textarea
                rows={2}
                value={form.allowed_models}
                onChange={(e) => patch('allowed_models', e.target.value)}
                placeholder='gpt-4o,claude-3-5-sonnet'
                className='font-mono text-12'
              />
              <p className='text-12 text-fg-2'>{t('plan.hint.allowed_models')}</p>
            </div>
          </Section>

          <Section title={t('plan.section.expiry')}>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.expires_at')}</Label>
                <Input
                  type='datetime-local'
                  value={form.expires_at_local}
                  onChange={(e) => patch('expires_at_local', e.target.value)}
                />
                <p className='text-12 text-fg-2'>{t('plan.hint.expires_at')}</p>
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.grace_period_seconds')}</Label>
                <Input
                  type='number'
                  min={0}
                  value={form.grace_period_seconds}
                  onChange={(e) => patch('grace_period_seconds', e.target.value)}
                  className='tabular-nums'
                />
                <p className='text-12 text-fg-2'>{t('plan.hint.grace')}</p>
              </div>
            </div>
          </Section>

          <Section title={t('plan.section.platform_quota')}>
            <p className='text-12 text-fg-2'>
              {t('plan.hint.platform_quota_used', {
                used: fmtDisplay(plan.platform_quota_used, cfg),
                cap:
                  plan.platform_quota_cap < 0
                    ? '∞'
                    : fmtDisplay(plan.platform_quota_cap, cfg),
              })}
            </p>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.platform_quota_cap')}</Label>
                <div className='flex items-center gap-2'>
                  <Input
                    type='number'
                    value={capText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCapText(v);
                      if (v === '' || v === '-') {
                        patch('platform_quota_cap', v);
                        return;
                      }
                      const n = Number(v);
                      if (!Number.isFinite(n)) return;
                      const raw = unitToRaw(n, capUnit, cfg);
                      patch('platform_quota_cap', String(raw));
                    }}
                    className='tabular-nums flex-1'
                    step={capUnit === 'quota' ? 1 : 'any'}
                  />
                  <Select
                    value={capUnit}
                    onValueChange={(v) => {
                      const next = v as QuotaUnit;
                      setCapUnit(next);
                      const raw = Number(form.platform_quota_cap);
                      if (!Number.isFinite(raw)) {
                        return;
                      }
                      if (raw < 0) {
                        setCapText(String(raw));
                        return;
                      }
                      setCapText(fmtCapNumber(rawToUnit(raw, next, cfg)));
                    }}
                  >
                    <SelectTrigger className='w-24 shrink-0'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='quota'>quota</SelectItem>
                      <SelectItem value='usd'>USD</SelectItem>
                      <SelectItem value='cny'>CNY</SelectItem>
                      {cfg.custom_currency_symbol &&
                      cfg.custom_currency_symbol !== '¤' ? (
                        <SelectItem value='custom'>
                          {cfg.custom_currency_symbol}
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
                <p className='text-12 text-fg-2'>
                  {t('plan.hint.platform_quota_cap')}
                  {(() => {
                    const raw = Number(form.platform_quota_cap);
                    if (!Number.isFinite(raw) || raw <= 0) return null;
                    const hasCustom =
                      !!cfg.custom_currency_symbol &&
                      cfg.custom_currency_symbol !== '¤';
                    const units = (
                      ['quota', 'usd', 'cny', 'custom'] as QuotaUnit[]
                    ).filter(
                      (u) => u !== capUnit && (u !== 'custom' || hasCustom)
                    );
                    const parts = units.map((u) => {
                      const v = rawToUnit(raw, u, cfg);
                      if (u === 'quota') return `${v.toFixed(0)} quota`;
                      return `${unitSymbol(u, cfg)}${fmtCapNumber(v)}`;
                    });
                    return (
                      <span className='ml-1 text-fg-1'>≈ {parts.join(' · ')}</span>
                    );
                  })()}
                </p>
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.platform_quota_period')}</Label>
                <Select
                  value={form.platform_quota_period}
                  onValueChange={(value) =>
                    patch('platform_quota_period', value as FormState['platform_quota_period'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>{t('plan.option.period_none')}</SelectItem>
                    <SelectItem value='daily'>{t('plan.option.period_daily')}</SelectItem>
                    <SelectItem value='monthly'>{t('plan.option.period_monthly')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className='text-12 text-fg-2'>{t('plan.hint.platform_quota_period')}</p>
              </div>
            </div>
          </Section>

          <Section title={t('plan.section.renewal')}>
            <p className='text-12 text-fg-2'>{t('plan.hint.renewal')}</p>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label>{t('plan.field.renew_price')}</Label>
                <div className='flex items-center gap-2'>
                  <span className='text-14 text-fg-2'>¥</span>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={form.renew_price_yuan}
                    onChange={(e) => patch('renew_price_yuan', e.target.value)}
                    className='tabular-nums'
                  />
                </div>
                <p className='text-12 text-fg-2'>
                  {renewEnabled
                    ? t('plan.hint.renew_enabled', { cents: renewCents })
                    : t('plan.hint.renew_disabled')}
                </p>
              </div>
              <div className='space-y-2'>
                <Label>{t('plan.field.renew_period_days')}</Label>
                <Input
                  type='number'
                  min={1}
                  value={form.renew_period_days}
                  onChange={(e) => patch('renew_period_days', e.target.value)}
                  className='tabular-nums'
                />
                <p className='text-12 text-fg-2'>{t('plan.hint.renew_period_days')}</p>
              </div>
            </div>
          </Section>

          <div className='flex justify-end gap-2 pt-1'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('plan.cancel')}
            </Button>
            <Button type='button' disabled={update.isPending} onClick={onSave}>
              {t('plan.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
