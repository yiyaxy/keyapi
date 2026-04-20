import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { WechatPayModal } from '@/components/payment/WechatPayModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useCreateWechatTopupNative, type CreateTopupResponse } from '@/hooks/useTopup';
import { ApiError } from '@/lib/api';

const PRESETS = [1, 5, 10, 20, 50, 100]; // CNY yuan presets
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 10000;

// RechargeCard is the "pay with WeChat" entry point on the user Topup page.
// Today the only channel is WeChat Native (PC scan); once alipay or stripe
// land on the same backend interface we'll add a method picker here.
export function RechargeCard() {
  const { t } = useTranslation('topup');
  const { refresh } = useAuth();
  const create = useCreateWechatTopupNative();

  const [preset, setPreset] = useState<number>(PRESETS[1]);
  const [custom, setCustom] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<CreateTopupResponse | null>(null);

  // Effective amount: custom wins if it's a positive number, else use preset.
  const customNum = Number(custom);
  const amount = Number.isFinite(customNum) && customNum > 0 ? customNum : preset;
  const canSubmit =
    amount >= MIN_AMOUNT && amount <= MAX_AMOUNT && !create.isPending;

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
              {PRESETS.map((v) => {
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
                    ¥{v}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor='custom-amount' className='mb-2 block'>
              {t('recharge.custom_label')}
            </Label>
            <Input
              id='custom-amount'
              type='number'
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step='1'
              inputMode='decimal'
              placeholder={t('recharge.custom_placeholder', {
                min: MIN_AMOUNT,
                max: MAX_AMOUNT,
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
                ¥{amount.toFixed(2)}
              </span>
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
