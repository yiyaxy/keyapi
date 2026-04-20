import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { saveBootstrap } from '@/lib/bootstrap';

import { InlineBanner } from './InlineBanner';

// WeChat mini-program scan-to-login modal.
// Flow:
//   mount/open → POST /api/oauth/wx_qr/ticket → show QR + poll every 2s
//   on "confirmed" → POST /api/oauth/wx_qr/login → save bootstrap → navigate
//   on "expired"   → offer refresh button

type TicketResponse = { ticket: string; qr_image: string; expires_in: number };
type PollResponse = { status: 'pending' | 'confirmed' | 'expired' };
type LoginResponse = { id: number; tenant_id: number };

type ViewState = 'loading' | 'pending' | 'confirmed' | 'expired' | 'error';

const POLL_INTERVAL_MS = 2000;

export function WechatQrModal({
  open,
  onOpenChange,
  redirectTo = '/',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  redirectTo?: string;
}) {
  const { t } = useTranslation('auth');
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [state, setState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  // Guards against running finalize() twice (poll + race on unmount).
  const finalizedRef = useRef(false);

  const requestTicket = useCallback(async () => {
    setState('loading');
    setError(null);
    finalizedRef.current = false;
    try {
      const res = await api.post<TicketResponse>('/api/oauth/wx_qr/ticket');
      setTicket(res.data);
      setState('pending');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
    }
  }, []);

  const finalize = useCallback(
    async (currentTicket: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      try {
        const res = await api.post<LoginResponse>('/api/oauth/wx_qr/login', {
          ticket: currentTicket,
        });
        saveBootstrap({ id: res.data.id, tenant_id: res.data.tenant_id ?? 1 });
        await refresh();
        onOpenChange(false);
        navigate(redirectTo, { replace: true });
      } catch (err) {
        setState('error');
        setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
      }
    },
    [navigate, onOpenChange, redirectTo, refresh],
  );

  // Kick off the ticket request when the dialog opens and clear state when closed.
  useEffect(() => {
    if (!open) {
      setTicket(null);
      setState('loading');
      setError(null);
      finalizedRef.current = false;
      return;
    }
    void requestTicket();
  }, [open, requestTicket]);

  // Poll for confirmation while a pending ticket exists.
  useEffect(() => {
    if (!open || !ticket || state !== 'pending') return;

    let cancelled = false;
    const deadline = Date.now() + ticket.expires_in * 1000;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setState('expired');
        return;
      }
      try {
        const res = await api.get<PollResponse>('/api/oauth/wx_qr/poll', {
          params: { ticket: ticket.ticket },
        });
        if (cancelled) return;
        if (res.data.status === 'confirmed') {
          setState('confirmed');
          void finalize(ticket.ticket);
          return;
        }
        if (res.data.status === 'expired') {
          setState('expired');
          return;
        }
      } catch {
        // transient network hiccup — let the next tick retry
      }
    };

    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, ticket, state, finalize]);

  const tip =
    state === 'pending' ? t('wechat_qr.tip_pending')
    : state === 'confirmed' ? t('wechat_qr.tip_confirmed')
    : state === 'expired' ? t('wechat_qr.tip_expired')
    : state === 'loading' ? t('wechat_qr.tip_loading')
    : t('wechat_qr.tip_error');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[360px]'>
        <DialogHeader>
          <DialogTitle>{t('wechat_qr.modal_title')}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col items-center gap-4 py-2'>
          <div className='relative flex h-[240px] w-[240px] items-center justify-center rounded-md border border-line bg-bg-1'>
            {ticket && state !== 'loading' && state !== 'error' ? (
              <img
                src={ticket.qr_image}
                alt='WeChat QR'
                className='h-full w-full rounded-md object-contain'
              />
            ) : (
              <span className='text-13 text-fg-2'>{tip}</span>
            )}
            {state === 'expired' && (
              <div className='absolute inset-0 flex items-center justify-center rounded-md bg-bg-1/85'>
                <Button type='button' size='sm' onClick={() => void requestTicket()}>
                  {t('wechat_qr.refresh')}
                </Button>
              </div>
            )}
          </div>

          {state !== 'expired' && state !== 'error' && (
            <p className='text-center text-13 text-fg-2'>{tip}</p>
          )}

          {error && (
            <InlineBanner level='danger' message={error} onClose={() => setError(null)} />
          )}

          {state === 'error' && (
            <Button
              type='button'
              variant='secondary'
              className='w-full'
              onClick={() => void requestTicket()}
            >
              {t('wechat_qr.refresh')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
