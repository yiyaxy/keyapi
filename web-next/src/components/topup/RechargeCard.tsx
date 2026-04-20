import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { WechatPayModal } from '@/components/payment/WechatPayModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';
import { useCreateWechatTopupNative, type CreateTopupResponse } from '@/hooks/useTopup';
import { ApiError } from '@/lib/api';

// Preset amounts are expressed in the tenant's display unit. Backend
// resolveTopupPrice() interprets the raw number the same way:
//   - USD/CNY: amount = display units (direct)
//   - TOKENS: amount = tokens, divided by QuotaPerUnit before pricing
// See controller/payment/topup.go:155 getPayMoney.
const PRESETS_USD = [1, 5, 10, 20, 50, 100];
const PRESETS_CNY = [10, 50, 100, 200, 500, 1000];
const PRESETS_TOKENS = [500_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000];

function presetsFor(cfg: PublicConfig): number[] {
  switch (cfg.quota_display_type) {
    case 'CNY':
      return PRESETS_CNY;
    case 'TOKENS':
      return PRESETS_TOKENS;
    default:
      return PRESETS_USD;
  }
}

function unitSymbol(cfg: PublicConfig): string {
  switch (cfg.quota_display_type) {
    case 'CNY':
      return '¥';
    case 'TOKENS':
      return '';
    case 'CUSTOM':
      return cfg.custom_currency_symbol || '¤';
    default:
      return '$';
  }
}

const MIN_AMOUNT = 1;
const MAX_AMOUNT_USD = 10000;
const MAX_AMOUNT_CNY = 100000;
const MAX_AMOUNT_TOKENS = 5_000_000_000;

function maxAmountFor(cfg: PublicConfig): number {
  switch (cfg.quota_display_type) {
    case 'CNY':
      return MAX_AMOUNT_CNY;
    case 'TOKENS':
      return MAX_AMOUNT_TOKENS;
    default:
      return MAX_AMOUNT_USD;
  }
}

// estimateCny mirrors backend getPayMoney() at controller/payment/topup.go
// for the happy path (no group ratio / discount applied). Used only for a
// preview hint — the WeChat modal shows the authoritative amount from the
// order response.
function estimateCny(amount: number, cfg: PublicConfig): number {
  const rate = cfg.usd_exchange_rate || 1;
  if (cfg.quota_display_type === 'TOKENS') {
    return (amount / cfg.quota_per_unit) * rate;
  }
  if (cfg.quota_display_type === 'CNY') {
    return amount;
  }
  if (cfg.quota_display_type === 'CUSTOM') {
    const usd = amount / (cfg.custom_currency_exchange_rate || 1);
    return usd * rate;
  }
  return amount * rate;
}

// RechargeCard is the "pay with WeChat" entry point on the user Topup page.
// Today the only channel is WeChat Native (PC scan); once alipay or stripe
// land on the same backend interface we'll add a method picker here.
export function RechargeCard() {
  const { t } = useTranslation('topup');
  const { refresh } = useAuth();
  const cfg = usePublicConfig();
  const create = useCreateWechatTopupNative();

  const presets = presetsFor(cfg);
  const symbol = unitSymbol(cfg);
  const maxAmount = maxAmountFor(cfg);
  const [preset, setPreset] = useState<number>(presets[1]);
  const [custom, setCustom] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<CreateTopupResponse | null>(null);

  // Effective amount: custom wins if it's a positive number, else use preset.
  const customNum = Number(custom);
  const amount = Number.isFinite(customNum) && customNum > 0 ? customNum : preset;
  const canSubmit =
    amount >= MIN_AMOUNT && amount <= maxAmount && !create.isPending;
  const isTokens = cfg.quota_display_type === 'TOKENS';

  async function onPay() {
    if (!canSubmit) return;
    try {
      const res = await create.mutateAsync({ amount });
      if (!res.response?.code_url) {
        // Defense-in-depth — backend shouldn't return without code_url on Native.
        toast.error(t('wechat.missing_code_url'));
        return;
      }
      setResult(res);
      setModalOpen(true);
    } catch (err) {
      const msg =
        err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err);
      toast.error(msg);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('recharge.title')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-13 text-fg-2'>{t('recharge.body')}</p>

          <div>
            <Label className='mb-2 block'>{t('recharge.amount_label')}</Label>
            <div className='grid grid-cols-3 gap-2'>
              {presets.map((v) => {
                const active = preset === v && custom === '';
                return (
                  <button
                    key={v}
                    type='button'
                    onClick={() => {
                      setPreset(v);
                      setCustom('');
                    }}
                    className={`rounded-md border px-3 py-2 text-13 tabular-nums transition ${
                      active
                        ? 'border-primary bg-primary/10 text-fg-0'
                        : 'border-line text-fg-1 hover:border-primary/50'
                    }`}
                  >
                    {symbol}
                    {isTokens ? v.toLocaleString() : v}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor='custom-amount' className='mb-2 block'>
              {t('recharge.custom_label', { unit: symbol || 'tokens' })}
            </Label>
            <Input
              id='custom-amount'
              type='number'
              min={MIN_AMOUNT}
              max={maxAmount}
              step={isTokens ? '1' : '1'}
              inputMode='decimal'
              placeholder={t('recharge.custom_placeholder', {
                min: MIN_AMOUNT,
                max: maxAmount,
              })}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className='tabular-nums'
            />
          </div>

          <div className='flex items-center justify-between border-t border-line pt-4'>
            <div className='text-13 text-fg-2'>
              {t('recharge.total')}
              <span className='ml-2 text-24 font-semibold tabular-nums text-fg-0'>
                {symbol}
                {isTokens ? amount.toLocaleString() : amount.toFixed(2)}
              </span>
              {cfg.quota_display_type !== 'CNY' && (
                <div className='mt-1 text-12 text-fg-3'>
                  {t('recharge.cny_estimate', {
                    amount: estimateCny(amount, cfg).toFixed(2),
                  })}
                </div>
              )}
            </div>
            <Button onClick={() => void onPay()} disabled={!canSubmit}>
              {create.isPending ? t('recharge.submitting') : t('recharge.pay_wechat')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <WechatPayModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        codeUrl={result?.response.code_url ?? null}
        outTradeNo={result?.order.out_trade_no ?? null}
        amountCents={result?.order.amount ?? Math.round(amount * 100)}
        onSuccess={() => {
          setResult(null);
          void refresh();
        }}
      />
    </>
  );
}
