import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchOrderRefundContext,
  useCreateRefund,
  useDeleteWechatConfig,
  useDeleteXpayProduct,
  useTenantPaymentOrders,
  useTenantPaymentRefunds,
  useTestWechatConfig,
  useUpdateWechatConfig,
  useUpsertXpayProduct,
  useWechatConfig,
  useXpayProducts,
  type OrderWithRefundContext,
  type PaymentRefundView,
  type WechatConfigView,
  type XpayPlatform,
  type XpayProductView,
  type XpayProductWritable,
} from '@/hooks/useTenantPayment';
import { fromDisplay, toDisplay, usePublicConfig } from '@/hooks/usePublicConfig';
import { fmtDateSec, fmtMoney } from '@/lib/format';

type Tab = 'config' | 'xpay' | 'orders' | 'refunds';
const PAGE_SIZE = 20;

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-13 ${
        active ? 'border-primary text-fg-0' : 'border-transparent text-fg-2 hover:text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}

function SecretState({ set }: { set: boolean }) {
  const { t } = useTranslation('tenantpay');
  return (
    <Badge variant={set ? 'default' : 'outline'}>{set ? t('secret.set') : t('secret.unset')}</Badge>
  );
}

function WechatConfigPanel({ data }: { data: WechatConfigView | null }) {
  const { t, i18n } = useTranslation('tenantpay');
  const update = useUpdateWechatConfig();
  const test = useTestWechatConfig();
  const del = useDeleteWechatConfig();
  const lang = i18n.language;

  const [appId, setAppId] = useState(data?.app_id ?? '');
  const [mchid, setMchid] = useState(data?.mchid ?? '');
  const [serialNo, setSerialNo] = useState(data?.serial_no ?? '');
  const [enabled, setEnabled] = useState(data?.enabled ?? false);
  const [miniLoginEnabled, setMiniLoginEnabled] = useState(data?.mini_login_enabled ?? false);
  const [xpayEnabled, setXpayEnabled] = useState(data?.xpay_enabled ?? false);
  const [xpayOfferId, setXpayOfferId] = useState(data?.xpay_offer_id ?? '');
  const [xpayEnv, setXpayEnv] = useState(data?.xpay_env || '0');
  const [appSecret, setAppSecret] = useState('');
  const [apiv3Key, setApiv3Key] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [xpayAppKey, setXpayAppKey] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const locked = data?.platform_locked;

  function save() {
    update.mutate(
      {
        enabled,
        mini_login_enabled: miniLoginEnabled,
        xpay_enabled: xpayEnabled,
        app_id: appId,
        mchid,
        serial_no: serialNo,
        xpay_offer_id: xpayOfferId,
        xpay_env: xpayEnv,
        app_secret: appSecret || undefined,
        apiv3_key: apiv3Key || undefined,
        private_key: privateKey || undefined,
        xpay_app_key: xpayAppKey || undefined,
      },
      {
        onSuccess: () => {
          setAppSecret('');
          setApiv3Key('');
          setPrivateKey('');
          setXpayAppKey('');
          toast.success(t('toast.save.success'));
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  function runTest() {
    test.mutate(undefined, {
      onSuccess: () => toast.success(t('toast.test.success')),
      onError: (e) => toast.error((e as Error).message),
    });
  }

  function runDelete() {
    setConfirmDelete(false);
    del.mutate(undefined, {
      onSuccess: () => toast.success(t('toast.delete.success')),
      onError: (e) => toast.error((e as Error).message),
    });
  }

  let testStatus = t('test.never');
  if (data?.last_test_at) {
    const when = fmtDateSec(data.last_test_at);
    testStatus = data.last_test_ok
      ? `${t('test.last', { at: when })} · ${t('test.ok')}`
      : t('test.failed', { msg: data.last_test_error || '' }) + ` (${when})`;
  }

  return (
    <div className='space-y-4'>
      {locked && <InlineBanner level='warn' message={t('locked.banner')} />}
      <div className='space-y-4 rounded-md border border-line bg-bg-1 p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='text-14 font-medium'>{t('form.section.public')}</h3>
          </div>
          <div className='flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <Label className='text-13'>{t('form.enabled')}</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={locked} />
            </div>
            <div className='flex items-center gap-2'>
              <Label className='text-13'>{t('form.mini_login_enabled')}</Label>
              <Switch
                checked={miniLoginEnabled}
                onCheckedChange={setMiniLoginEnabled}
                disabled={locked}
              />
            </div>
          </div>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label htmlFor='wx-app-id'>{t('form.app_id')}</Label>
            <Input
              id='wx-app-id'
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              disabled={locked}
              className='font-mono text-12'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wx-mchid'>{t('form.mchid')}</Label>
            <Input
              id='wx-mchid'
              value={mchid}
              onChange={(e) => setMchid(e.target.value)}
              disabled={locked}
              className='font-mono text-12'
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='wx-serial'>{t('form.serial_no')}</Label>
            <Input
              id='wx-serial'
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              disabled={locked}
              className='font-mono text-12'
            />
          </div>
        </div>
      </div>
      <div className='space-y-4 rounded-md border border-line bg-bg-1 p-4'>
        <div className='flex items-center justify-between'>
          <h3 className='text-14 font-medium'>Virtual payment</h3>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>Enabled</Label>
            <Switch checked={xpayEnabled} onCheckedChange={setXpayEnabled} disabled={locked} />
          </div>
        </div>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label htmlFor='wx-xpay-offer'>Offer ID</Label>
            <Input
              id='wx-xpay-offer'
              value={xpayOfferId}
              onChange={(e) => setXpayOfferId(e.target.value)}
              disabled={locked}
              className='font-mono text-12'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wx-xpay-env'>Env</Label>
            <Select value={xpayEnv} onValueChange={setXpayEnv} disabled={locked}>
              <SelectTrigger id='wx-xpay-env'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='0'>Production</SelectItem>
                <SelectItem value='1'>Sandbox</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='wx-xpay-app-key'>AppKey</Label>
              <SecretState set={data?.xpay_app_key_set ?? false} />
            </div>
            <Input
              id='wx-xpay-app-key'
              type='password'
              value={xpayAppKey}
              onChange={(e) => setXpayAppKey(e.target.value)}
              disabled={locked}
              placeholder={data?.xpay_app_key_set ? 'stored' : undefined}
            />
          </div>
        </div>
      </div>
      <div className='space-y-4 rounded-md border border-line bg-bg-1 p-4'>
        <h3 className='text-14 font-medium'>{t('form.section.secrets')}</h3>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='wx-app-secret'>{t('form.app_secret')}</Label>
              <SecretState set={data?.app_secret_set ?? false} />
            </div>
            <Input
              id='wx-app-secret'
              type='password'
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              disabled={locked}
              placeholder={data?.app_secret_set ? '••••••••' : undefined}
            />
          </div>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='wx-apiv3'>{t('form.apiv3_key')}</Label>
              <SecretState set={data?.apiv3_key_set ?? false} />
            </div>
            <Input
              id='wx-apiv3'
              type='password'
              value={apiv3Key}
              onChange={(e) => setApiv3Key(e.target.value)}
              disabled={locked}
              placeholder={data?.apiv3_key_set ? '••••••••' : undefined}
            />
          </div>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='wx-pk'>{t('form.private_key')}</Label>
              <SecretState set={data?.private_key_set ?? false} />
            </div>
            <Textarea
              id='wx-pk'
              rows={6}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              disabled={locked}
              placeholder={
                data?.private_key_set
                  ? '-----BEGIN PRIVATE KEY-----\n... (stored) ...\n-----END PRIVATE KEY-----'
                  : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
              }
              className='font-mono text-12'
            />
          </div>
        </div>
      </div>
      <div className='flex items-center justify-between gap-2'>
        <div className='text-12 text-fg-2'>{testStatus}</div>
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='ghost'
            className='text-danger'
            disabled={locked || del.isPending || !data}
            onClick={() => setConfirmDelete(true)}
          >
            {t('action.delete')}
          </Button>
          <Button
            type='button'
            variant='secondary'
            disabled={locked || test.isPending || !data}
            onClick={runTest}
          >
            {t('action.test')}
          </Button>
          <Button type='button' disabled={locked || update.isPending} onClick={save}>
            {t('action.save')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t('delete.title')}
        body={t('delete.body')}
        confirmLabel={t('delete.confirm')}
        isPending={del.isPending}
        onOpenChange={setConfirmDelete}
        onConfirm={runDelete}
      />
      <div className='hidden'>{lang}</div>
    </div>
  );
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'paid') return 'default';
  if (s === 'refunded') return 'destructive';
  if (s === 'pending') return 'secondary';
  return 'outline';
}

function OrdersPanel() {
  const { t } = useTranslation('tenantpay');
  const [page, setPage] = useState(1);
  const [type, setType] = useState('0');
  const [status, setStatus] = useState('0');

  const list = useTenantPaymentOrders({
    page,
    page_size: PAGE_SIZE,
    order_type: type === '0' ? undefined : type,
    status: status === '0' ? undefined : status,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('orders.filter.type.all')}</SelectItem>
            <SelectItem value='topup'>{t('orders.filter.type.topup')}</SelectItem>
            <SelectItem value='subscription'>{t('orders.filter.type.subscription')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('orders.filter.status.all')}</SelectItem>
            <SelectItem value='pending'>{t('orders.filter.status.pending')}</SelectItem>
            <SelectItem value='paid'>{t('orders.filter.status.paid')}</SelectItem>
            <SelectItem value='refunded'>{t('orders.filter.status.refunded')}</SelectItem>
            <SelectItem value='expired'>{t('orders.filter.status.expired')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('orders.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('orders.col.out_trade_no')}</th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.type')}</th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.amount')}</th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.status')}</th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.created')}</th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='max-w-[220px] truncate px-3 py-2 font-mono text-12'>
                    {o.out_trade_no}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant='outline'>{o.order_type}</Badge>
                  </td>
                  <td className='px-3 py-2 text-right'>
                    {fmtMoney(o.amount / 100, o.currency || 'CNY')}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                  </td>
                  <td className='px-3 py-2 text-fg-1'>{fmtDateSec(o.created_at)}</td>
                  <td className='px-3 py-2 text-fg-1'>{o.paid_at ? fmtDateSec(o.paid_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className='flex items-center justify-end gap-2'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t('pagination.prev')}
        </Button>
        <span className='text-12 text-fg-2'>
          {page} · {total}
        </span>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page * PAGE_SIZE >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('pagination.next')}
        </Button>
      </div>
    </div>
  );
}

// ─── Refunds ─────────────────────────────────────────────────────────

function refundStatusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'succeeded') return 'default';
  if (s === 'failed' || s === 'closed') return 'destructive';
  if (s === 'pending' || s === 'processing') return 'secondary';
  return 'outline';
}

type QuotaMode = 'auto' | 'none' | 'custom';

function RefundInitiateDialog({
  open,
  onOpenChange,
  initialOutTradeNo = '',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialOutTradeNo?: string;
}) {
  const { t } = useTranslation('tenantpay');
  const cfg = usePublicConfig();
  const createRefund = useCreateRefund();

  const [outTradeNo, setOutTradeNo] = useState(initialOutTradeNo);
  const [amountYuan, setAmountYuan] = useState('');
  const [reason, setReason] = useState('');
  const [quotaMode, setQuotaMode] = useState<QuotaMode>('auto');
  const [customDisplay, setCustomDisplay] = useState('');

  // Order context is fetched after the admin enters an out_trade_no.
  // null = not-yet-fetched, undefined = fetched but failed (fall back to
  // simple dialog without deduction UX).
  const [ctx, setCtx] = useState<OrderWithRefundContext | null | undefined>(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  // Reset + refetch on reopen. Swallow quickly-changing initialOutTradeNo
  // state so the dialog always starts from the explicitly-passed id.
  useEffect(() => {
    if (!open) return;
    setOutTradeNo(initialOutTradeNo);
    setAmountYuan('');
    setReason('');
    setQuotaMode('auto');
    setCustomDisplay('');
    setCtx(null);
    setCtxLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialOutTradeNo]);

  // Debounced order fetch. Triggered when out_trade_no looks plausibly
  // complete (≥12 chars is enough to guess it's a full id — BuildOutTradeNo
  // produces wx_tN_K_<unix>_<rand6> = ~20+ chars).
  useEffect(() => {
    if (!open) return;
    const trimmed = outTradeNo.trim();
    if (trimmed.length < 12) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCtxLoading(true);
      try {
        const res = await fetchOrderRefundContext(trimmed);
        if (!cancelled) setCtx(res);
      } catch {
        if (!cancelled) setCtx(undefined);
      } finally {
        if (!cancelled) setCtxLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [outTradeNo, open]);

  const amount = Number(amountYuan);
  const amountCents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;

  // Refundable cap: order.amount - order.refunded_amount. Without ctx we
  // don't enforce — backend will.
  const maxRefundCents = ctx ? Math.max(ctx.amount - ctx.refunded_amount, 0) : Infinity;

  // Proportional quota deduction: how much of the originally credited
  // raw quota corresponds to this refund amount.
  const proportionalQuota =
    ctx && ctx.amount > 0 && ctx.credited_quota > 0
      ? Math.round((amountCents / ctx.amount) * ctx.credited_quota)
      : 0;

  // "Auto" clamps proportional to what the user has on hand. The refund
  // is always for a topup at this point (backend forces delta=0 for sub);
  // a quota-less order type shows a disabled section.
  const autoQuota = ctx ? Math.max(0, Math.min(proportionalQuota, ctx.payer_current_quota)) : 0;

  const customQuota = useMemo(() => {
    const d = Number(customDisplay);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return fromDisplay(d, cfg);
  }, [customDisplay, cfg]);

  const chosenQuotaDelta =
    quotaMode === 'auto' ? autoQuota : quotaMode === 'custom' ? customQuota : 0;

  const deductionAvailable = Boolean(ctx && ctx.order_type === 'topup' && ctx.credited_quota > 0);

  // Display helpers for the banner
  const fmtRaw = (raw: number): string => {
    if (raw <= 0) return '—';
    const d = toDisplay(raw, cfg);
    const body = d.digits === 0 ? d.value.toLocaleString() : d.value.toFixed(d.digits);
    return cfg.quota_display_type === 'TOKENS' ? body : `${d.symbol}${body}`;
  };

  async function submit() {
    if (!outTradeNo.trim()) {
      toast.error(t('refunds.error.no_order'));
      return;
    }
    if (amountCents <= 0) {
      toast.error(t('refunds.error.invalid_amount'));
      return;
    }
    if (Number.isFinite(maxRefundCents) && amountCents > maxRefundCents) {
      toast.error(t('refunds.error.over_max'));
      return;
    }
    try {
      await createRefund.mutateAsync({
        out_trade_no: outTradeNo.trim(),
        amount_cents: amountCents,
        reason: reason.trim() || undefined,
        user_quota_delta: deductionAvailable ? chosenQuotaDelta : 0,
      });
      toast.success(t('refunds.submitted'));
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-[520px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{t('refunds.dialog.title')}</DialogTitle>
          <DialogDescription>{t('refunds.dialog.body')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-2'>
            <Label>{t('refunds.field.out_trade_no')}</Label>
            <Input
              value={outTradeNo}
              onChange={(e) => setOutTradeNo(e.target.value)}
              placeholder='wx_t1_T_...'
              className='font-mono text-12'
            />
            {ctxLoading && <p className='text-12 text-fg-2'>{t('refunds.ctx.loading')}</p>}
            {ctx === undefined && !ctxLoading && (
              <p className='text-12 text-fg-2'>{t('refunds.ctx.unavailable')}</p>
            )}
          </div>

          {/* Order context banner */}
          {ctx && (
            <div className='rounded-md border border-line bg-bg-1 px-3 py-2 text-12 tabular-nums'>
              <div className='flex items-center justify-between'>
                <span className='text-fg-2'>{t('refunds.ctx.payer')}</span>
                <span className='font-medium text-fg-0'>
                  {ctx.payer_username || `user#${ctx.payer_user_id}`}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-fg-2'>{t('refunds.ctx.order_amount')}</span>
                <span className='text-fg-0'>
                  ¥{(ctx.amount / 100).toFixed(2)}
                  {ctx.refunded_amount > 0 && (
                    <span className='ml-1 text-fg-2'>
                      (
                      {t('refunds.ctx.already_refunded', {
                        amount: (ctx.refunded_amount / 100).toFixed(2),
                      })}
                      )
                    </span>
                  )}
                </span>
              </div>
              {ctx.order_type === 'topup' && (
                <>
                  <div className='flex items-center justify-between'>
                    <span className='text-fg-2'>{t('refunds.ctx.credited_quota')}</span>
                    <span className='text-fg-0'>{fmtRaw(ctx.credited_quota)}</span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-fg-2'>{t('refunds.ctx.payer_quota')}</span>
                    <span className='text-fg-0'>{fmtRaw(ctx.payer_current_quota)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className='space-y-2'>
            <Label>{t('refunds.field.amount')}</Label>
            <div className='flex items-center gap-2'>
              <span className='text-14 text-fg-2'>¥</span>
              <Input
                type='number'
                min={0}
                step='0.01'
                inputMode='decimal'
                value={amountYuan}
                onChange={(e) => setAmountYuan(e.target.value)}
                className='tabular-nums'
              />
            </div>
            {Number.isFinite(maxRefundCents) && (
              <p className='text-12 text-fg-2'>
                {t('refunds.field.amount_max', {
                  max: (maxRefundCents / 100).toFixed(2),
                })}
              </p>
            )}
          </div>

          {/* Quota deduction options — only shown for topups with a known payer */}
          {deductionAvailable && (
            <div className='space-y-2 rounded-md border border-line bg-bg-1 p-3'>
              <Label>{t('refunds.quota.title')}</Label>
              <p className='text-12 text-fg-2'>{t('refunds.quota.body')}</p>
              <label className='flex items-start gap-2 text-13'>
                <input
                  type='radio'
                  checked={quotaMode === 'auto'}
                  onChange={() => setQuotaMode('auto')}
                  className='mt-1'
                />
                <span>
                  <span className='font-medium'>{t('refunds.quota.auto')}</span>
                  <span className='ml-2 text-fg-2'>
                    {t('refunds.quota.auto_hint', {
                      amount: fmtRaw(autoQuota),
                      raw: autoQuota.toLocaleString(),
                    })}
                  </span>
                  {autoQuota < proportionalQuota && (
                    <p className='text-12 text-fg-2'>
                      {t('refunds.quota.clamp_note', {
                        requested: fmtRaw(proportionalQuota),
                      })}
                    </p>
                  )}
                </span>
              </label>
              <label className='flex items-start gap-2 text-13'>
                <input
                  type='radio'
                  checked={quotaMode === 'none'}
                  onChange={() => setQuotaMode('none')}
                  className='mt-1'
                />
                <span>
                  <span className='font-medium'>{t('refunds.quota.none')}</span>
                  <span className='ml-2 text-fg-2'>{t('refunds.quota.none_hint')}</span>
                </span>
              </label>
              <label className='flex items-start gap-2 text-13'>
                <input
                  type='radio'
                  checked={quotaMode === 'custom'}
                  onChange={() => setQuotaMode('custom')}
                  className='mt-1'
                />
                <span className='flex-1'>
                  <span className='font-medium'>{t('refunds.quota.custom')}</span>
                  <div className='mt-1 flex items-center gap-2'>
                    {cfg.quota_display_type !== 'TOKENS' && (
                      <span className='text-14 text-fg-2'>{toDisplay(0, cfg).symbol}</span>
                    )}
                    <Input
                      type='number'
                      min={0}
                      step={cfg.quota_display_type === 'TOKENS' ? '1' : '0.01'}
                      inputMode='decimal'
                      value={customDisplay}
                      onChange={(e) => {
                        setCustomDisplay(e.target.value);
                        if (e.target.value) setQuotaMode('custom');
                      }}
                      className='tabular-nums'
                      placeholder='0'
                    />
                  </div>
                  {quotaMode === 'custom' && customQuota > ctx!.payer_current_quota && (
                    <p className='text-12 text-danger'>
                      {t('refunds.quota.custom_over', {
                        max: fmtRaw(ctx!.payer_current_quota),
                      })}
                    </p>
                  )}
                </span>
              </label>
            </div>
          )}

          <div className='space-y-2'>
            <Label>{t('refunds.field.reason')}</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('refunds.field.reason_hint')}
            />
          </div>
          <div className='flex justify-end gap-2 pt-1'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('refunds.cancel')}
            </Button>
            <Button type='button' onClick={submit} disabled={createRefund.isPending}>
              {t('refunds.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RefundQuotaCell({
  refund,
  cfg,
}: {
  refund: PaymentRefundView;
  cfg: ReturnType<typeof usePublicConfig>;
}) {
  const { t } = useTranslation('tenantpay');
  const fmt = (raw: number) => {
    if (raw <= 0) return '—';
    const d = toDisplay(raw, cfg);
    const body = d.digits === 0 ? d.value.toLocaleString() : d.value.toFixed(d.digits);
    return cfg.quota_display_type === 'TOKENS' ? body : `${d.symbol}${body}`;
  };
  // Post-refund the applied delta is canon. Pre-refund (pending) we show
  // the requested delta. When they disagree (partial-clamp) we surface
  // both so the admin can tell if the user had spent some of the topup.
  if (refund.status === 'succeeded') {
    if (refund.user_quota_delta_applied <= 0) return <span>—</span>;
    if (refund.user_quota_delta_applied < refund.user_quota_delta) {
      return (
        <span>
          <span>{fmt(refund.user_quota_delta_applied)}</span>
          <span className='ml-1 text-11 text-fg-2'>
            {t('refunds.col.quota_clamped', {
              requested: fmt(refund.user_quota_delta),
            })}
          </span>
        </span>
      );
    }
    return <span>{fmt(refund.user_quota_delta_applied)}</span>;
  }
  if (refund.user_quota_delta > 0) {
    return (
      <span>
        {fmt(refund.user_quota_delta)}
        <span className='ml-1 text-11 text-fg-2'>{t('refunds.col.quota_pending')}</span>
      </span>
    );
  }
  return <span>—</span>;
}

function RefundsPanel() {
  const { t } = useTranslation('tenantpay');
  const cfg = usePublicConfig();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('0');
  const [initiateOpen, setInitiateOpen] = useState(false);

  const list = useTenantPaymentRefunds({
    page,
    page_size: PAGE_SIZE,
    status: status === '0' ? undefined : status,
  });

  const items: PaymentRefundView[] = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className='max-w-[180px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='0'>{t('refunds.filter.status.all')}</SelectItem>
            <SelectItem value='pending'>{t('refunds.filter.status.pending')}</SelectItem>
            <SelectItem value='succeeded'>{t('refunds.filter.status.succeeded')}</SelectItem>
            <SelectItem value='failed'>{t('refunds.filter.status.failed')}</SelectItem>
            <SelectItem value='closed'>{t('refunds.filter.status.closed')}</SelectItem>
          </SelectContent>
        </Select>
        <div className='ml-auto' />
        <Button type='button' size='sm' onClick={() => setInitiateOpen(true)}>
          {t('refunds.initiate')}
        </Button>
      </div>

      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('refunds.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.out_refund_no')}</th>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.out_trade_no')}</th>
                <th className='px-3 py-2 font-medium text-right'>{t('refunds.col.amount')}</th>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.status')}</th>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.created')}</th>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.refunded_at')}</th>
                <th className='px-3 py-2 font-medium text-right'>{t('refunds.col.quota_delta')}</th>
                <th className='px-3 py-2 font-medium'>{t('refunds.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='max-w-[200px] truncate px-3 py-2 font-mono text-12'>
                    {r.out_refund_no}
                  </td>
                  <td className='max-w-[200px] truncate px-3 py-2 font-mono text-12'>
                    {r.out_trade_no}
                  </td>
                  <td className='px-3 py-2 text-right'>
                    {fmtMoney(r.amount / 100, r.currency || 'CNY')}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant={refundStatusVariant(r.status)}>{r.status}</Badge>
                    {r.last_error && (
                      <p className='mt-1 max-w-[220px] truncate text-11 text-danger'>
                        {r.last_error}
                      </p>
                    )}
                  </td>
                  <td className='px-3 py-2 text-fg-1'>{fmtDateSec(r.created_at)}</td>
                  <td className='px-3 py-2 text-fg-1'>
                    {r.refunded_at ? fmtDateSec(r.refunded_at) : '—'}
                  </td>
                  <td className='px-3 py-2 text-right text-fg-1'>
                    <RefundQuotaCell refund={r} cfg={cfg} />
                  </td>
                  <td className='max-w-[200px] truncate px-3 py-2 text-fg-1'>{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className='flex items-center justify-end gap-2'>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t('pagination.prev')}
        </Button>
        <span className='text-12 text-fg-2'>
          {page} · {total}
        </span>
        <Button
          type='button'
          variant='secondary'
          size='sm'
          disabled={page * PAGE_SIZE >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('pagination.next')}
        </Button>
      </div>

      <RefundInitiateDialog open={initiateOpen} onOpenChange={setInitiateOpen} />
    </div>
  );
}

// XpayProductsPanel — operator UI for tenant_xpay_products. One tier ×
// platform = one row. Backend treats UPDATE as a strict PUT replace, so the
// edit dialog hydrates the form from the existing row and sends every
// writable field back. tier_code + platform are immutable on edit.
function XpayProductsPanel() {
  const { t } = useTranslation('tenantpay');
  const [platform, setPlatform] = useState<'all' | XpayPlatform>('all');
  const [editing, setEditing] = useState<XpayProductView | 'new' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const list = useXpayProducts(platform === 'all' ? undefined : platform);
  const del = useDeleteXpayProduct();

  const items = list.data ?? [];
  const target = items.find((r) => r.id === confirmDeleteId);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={platform} onValueChange={(v) => setPlatform(v as 'all' | XpayPlatform)}>
          <SelectTrigger className='max-w-[160px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('xpay.filter.all')}</SelectItem>
            <SelectItem value='android'>Android</SelectItem>
            <SelectItem value='ios'>iOS</SelectItem>
          </SelectContent>
        </Select>
        <div className='ml-auto'>
          <Button type='button' size='sm' onClick={() => setEditing('new')}>
            {t('xpay.action.add')}
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : list.isError ? (
        <InlineBanner level='danger' message={String((list.error as Error).message)} />
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('xpay.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.tier')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.name')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.platform')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.product_id')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.amount')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.quota')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.enabled')}</th>
                <th className='px-3 py-2 font-medium'>{t('xpay.col.sort')}</th>
                <th className='px-3 py-2 font-medium' />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 font-mono text-12'>{r.tier_code}</td>
                  <td className='px-3 py-2'>{r.name}</td>
                  <td className='px-3 py-2'>
                    <Badge variant='outline'>{r.platform}</Badge>
                  </td>
                  <td className='max-w-[200px] truncate px-3 py-2 font-mono text-12'>
                    {r.product_id || <span className='text-fg-2'>—</span>}
                  </td>
                  <td className='px-3 py-2'>{fmtMoney(r.amount_cents / 100)}</td>
                  <td className='px-3 py-2'>+{r.quota_delta.toLocaleString()}</td>
                  <td className='px-3 py-2'>
                    <Badge variant={r.enabled ? 'default' : 'outline'}>
                      {r.enabled ? t('xpay.badge.on') : t('xpay.badge.off')}
                    </Badge>
                  </td>
                  <td className='px-3 py-2 text-fg-2'>{r.sort_order}</td>
                  <td className='px-3 py-2'>
                    <div className='flex justify-end gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        onClick={() => setEditing(r)}
                      >
                        {t('xpay.action.edit')}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        className='text-danger'
                        onClick={() => setConfirmDeleteId(r.id)}
                      >
                        {t('xpay.action.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <XpayProductDialog
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={t('xpay.delete.title')}
        body={t('xpay.delete.body', {
          tier: target?.tier_code ?? '',
          platform: target?.platform ?? '',
        })}
        confirmLabel={t('xpay.action.delete')}
        isPending={del.isPending}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        onConfirm={() => {
          if (confirmDeleteId === null) return;
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          del.mutate(id, {
            onSuccess: () => toast.success(t('xpay.toast.deleted')),
            onError: (e) => toast.error((e as Error).message),
          });
        }}
      />
    </div>
  );
}

// XpayProductDialog covers both CREATE and UPDATE. On UPDATE, tier_code and
// platform are read-only because they are part of the row's unique
// (tenant_id, tier_code, platform) identity — backend rejects mutations on
// either column to avoid orphaning in-flight orders.
function XpayProductDialog({
  existing,
  onClose,
}: {
  existing: XpayProductView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('tenantpay');
  const upsert = useUpsertXpayProduct();
  const isEdit = existing !== null;

  const [tierCode, setTierCode] = useState(existing?.tier_code ?? '');
  const [platform, setPlatform] = useState<XpayPlatform>(
    (existing?.platform as XpayPlatform) ?? 'android'
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [productId, setProductId] = useState(existing?.product_id ?? '');
  // amount_cents stored as a CNY-yuan string in the input so users type ¥30
  // not 3000 cents — converted at submit.
  const [amountYuan, setAmountYuan] = useState(
    existing ? (existing.amount_cents / 100).toString() : ''
  );
  const [quotaDelta, setQuotaDelta] = useState(existing ? String(existing.quota_delta) : '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [sortOrder, setSortOrder] = useState(existing ? String(existing.sort_order) : '0');

  function submit() {
    const trimmedTier = tierCode.trim();
    const trimmedName = name.trim();
    const trimmedProductId = productId.trim();
    const yuan = Number(amountYuan);
    const quota = Number(quotaDelta);
    const sort = Number(sortOrder) || 0;

    if (!trimmedTier || !trimmedName) {
      toast.error(t('xpay.error.required'));
      return;
    }
    if (!Number.isFinite(yuan) || yuan <= 0) {
      toast.error(t('xpay.error.amount'));
      return;
    }
    if (!Number.isFinite(quota) || quota <= 0 || !Number.isInteger(quota)) {
      toast.error(t('xpay.error.quota'));
      return;
    }
    if (enabled && !trimmedProductId) {
      toast.error(t('xpay.error.product_id_required'));
      return;
    }
    const body: XpayProductWritable = {
      tier_code: trimmedTier,
      name: trimmedName,
      product_id: trimmedProductId,
      platform,
      amount_cents: Math.round(yuan * 100),
      quota_delta: quota,
      enabled,
      sort_order: sort,
    };
    upsert.mutate(
      { id: existing?.id, body },
      {
        onSuccess: () => {
          toast.success(t(isEdit ? 'xpay.toast.updated' : 'xpay.toast.created'));
          onClose();
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('xpay.dialog.title.edit') : t('xpay.dialog.title.add')}
          </DialogTitle>
          <DialogDescription>{t('xpay.dialog.body')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='xpay-tier'>{t('xpay.field.tier')}</Label>
              <Input
                id='xpay-tier'
                value={tierCode}
                onChange={(e) => setTierCode(e.target.value)}
                disabled={isEdit}
                className='font-mono text-12'
                placeholder='tier_30'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='xpay-platform'>{t('xpay.field.platform')}</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as XpayPlatform)}
                disabled={isEdit}
              >
                <SelectTrigger id='xpay-platform'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='android'>Android</SelectItem>
                  <SelectItem value='ios'>iOS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='xpay-name'>{t('xpay.field.name')}</Label>
            <Input
              id='xpay-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('xpay.field.name_placeholder')}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='xpay-product-id'>{t('xpay.field.product_id')}</Label>
            <Input
              id='xpay-product-id'
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className='font-mono text-12'
              placeholder='tier_30_android'
            />
            <p className='text-12 text-fg-2'>{t('xpay.field.product_id_hint')}</p>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='xpay-amount'>{t('xpay.field.amount')}</Label>
              <Input
                id='xpay-amount'
                type='number'
                inputMode='decimal'
                step='0.01'
                min='0'
                value={amountYuan}
                onChange={(e) => setAmountYuan(e.target.value)}
                placeholder='30'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='xpay-quota'>{t('xpay.field.quota')}</Label>
              <Input
                id='xpay-quota'
                type='number'
                inputMode='numeric'
                step='1'
                min='1'
                value={quotaDelta}
                onChange={(e) => setQuotaDelta(e.target.value)}
                placeholder='30000'
              />
            </div>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='xpay-sort'>{t('xpay.field.sort')}</Label>
              <Input
                id='xpay-sort'
                type='number'
                inputMode='numeric'
                step='1'
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div className='flex items-end gap-2'>
              <div className='flex items-center gap-2'>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label className='text-13'>{t('xpay.field.enabled')}</Label>
              </div>
            </div>
          </div>
        </div>
        <div className='flex justify-end gap-2 pt-2'>
          <Button type='button' variant='secondary' onClick={onClose}>
            {t('refunds.cancel')}
          </Button>
          <Button type='button' onClick={submit} disabled={upsert.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TenantPaymentPage() {
  const { t } = useTranslation('tenantpay');
  const [tab, setTab] = useState<Tab>('config');
  const config = useWechatConfig();

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-1 border-b border-line'>
        <TabBtn active={tab === 'config'} onClick={() => setTab('config')}>
          {t('tab.config')}
        </TabBtn>
        <TabBtn active={tab === 'xpay'} onClick={() => setTab('xpay')}>
          {t('tab.xpay')}
        </TabBtn>
        <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')}>
          {t('tab.orders')}
        </TabBtn>
        <TabBtn active={tab === 'refunds'} onClick={() => setTab('refunds')}>
          {t('tab.refunds')}
        </TabBtn>
      </div>
      {tab === 'config' ? (
        config.isPending ? (
          <Skeleton className='h-64 w-full' />
        ) : config.isError ? (
          <InlineBanner level='danger' message={String((config.error as Error).message)} />
        ) : (
          <WechatConfigPanel
            key={`wx-${config.data?.id ?? 'none'}-${config.data?.updated_at ?? 0}`}
            data={config.data ?? null}
          />
        )
      ) : tab === 'xpay' ? (
        <XpayProductsPanel />
      ) : tab === 'orders' ? (
        <OrdersPanel />
      ) : (
        <RefundsPanel />
      )}
    </div>
  );
}
