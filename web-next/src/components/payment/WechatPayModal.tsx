import { QRCodeCanvas } from 'qrcode.react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { usePaymentOrderPolling, type PaymentOrderStatus } from '@/hooks/useTopup';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codeUrl: string | null; // null → still loading the order from backend
  outTradeNo: string | null;
  amountCents: number; // for the amount caption
  onSuccess?: () => void;
};

// WechatPayModal shows the Native QR code for a just-created topup order
// and polls for its terminal state. On "paid" it fires onSuccess and closes.
// On "expired" / "closed" it toasts and closes. "pending" keeps the QR live.
export function WechatPayModal({
  open,
  onOpenChange,
  codeUrl,
  outTradeNo,
  amountCents,
  onSuccess,
}: Props) {
  const { t } = useTranslation('topup');
  const poll = usePaymentOrderPolling(outTradeNo, open);
  const status: PaymentOrderStatus | undefined = poll.data?.status;

  // Fire onSuccess exactly once when the poll reports paid. Using a ref
  // guard so React strict-mode doesn't double-invoke the side effect in dev.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (!status) return;

    if (status === 'paid' || status === 'partial_refunded' || status === 'fully_refunded') {
      if (firedRef.current) return;
      firedRef.current = true;
      toast.success(t('wechat.paid'));
      onSuccess?.();
      onOpenChange(false);
    } else if (status === 'expired') {
      toast.info(t('wechat.expired'));
      onOpenChange(false);
    } else if (status === 'closed') {
      toast.info(t('wechat.closed'));
      onOpenChange(false);
    }
  }, [open, status, t, onSuccess, onOpenChange]);

  const yuan = (amountCents / 100).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[400px]'>
        <DialogHeader>
          <DialogTitle>{t('wechat.modal_title')}</DialogTitle>
          <DialogDescription>
            {t('wechat.modal_desc', { amount: yuan })}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col items-center gap-4 py-2'>
          <div className='relative flex h-[240px] w-[240px] items-center justify-center rounded-md border border-line bg-white p-3'>
            {codeUrl ? (
              <QRCodeCanvas value={codeUrl} size={216} level='M' includeMargin={false} />
            ) : (
              <Skeleton className='h-full w-full' />
            )}
          </div>

          <p className='text-center text-13 text-fg-2'>
            {!codeUrl
              ? t('wechat.tip_loading')
              : status === 'paid'
                ? t('wechat.tip_paid')
                : t('wechat.tip_scan')}
          </p>

          {outTradeNo && (
            <p className='text-11 tabular-nums text-fg-2'>
              {t('wechat.order_no')}
              <span className='ml-1 font-mono'>{outTradeNo}</span>
            </p>
          )}

          <Button
            type='button'
            variant='secondary'
            className='w-full'
            onClick={() => onOpenChange(false)}
          >
            {t('wechat.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
