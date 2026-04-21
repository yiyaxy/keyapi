import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';

import { InlineBanner } from './InlineBanner';

// Scan-to-bind flow for an already-logged-in user. Similar shape to
// WechatQrModal (login), but:
//   - POSTs /api/oauth/wx_qr/bind/ticket (requires session)
//   - polls /api/oauth/wx_qr/bind/poll — may surface "merge_required"
//   - on confirmed clean path: calls finalize, refreshes user.
//   - on merge_required: swaps to a confirmation view showing the other
//     account's info, calls finalize with confirm_merge=true on user consent.
//
// No navigation on success; caller closes the dialog and we refresh auth.

type TicketResponse = { ticket: string; qr_image: string; expires_in: number };

type MergeCandidate = {
  user_id: number;
  username: string;
  display_name: string;
  email: string;
  quota: number;
  used_quota: number;
  token_count: number;
};

type PollResponse = {
  status: 'pending' | 'confirmed' | 'merge_required' | 'expired';
  merge_candidate?: MergeCandidate;
};

type FinalizeResponse = {
  bound: boolean;
  merged?: boolean;
  merged_quota?: number;
  merge_candidate?: MergeCandidate;
};

type ViewState =
  | 'loading'
  | 'pending'
  | 'confirmed'
  | 'merge_confirm'
  | 'merging'
  | 'expired'
  | 'error'
  | 'done';

const POLL_INTERVAL_MS = 2000;

export function WechatBindQrModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('account');
  const { refresh } = useAuth();

  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [state, setState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<MergeCandidate | null>(null);

  // Guards finalize() double-fire from poll race.
  const finalizedRef = useRef(false);

  const reset = useCallback(() => {
    setTicket(null);
    setState('loading');
    setError(null);
    setCandidate(null);
    finalizedRef.current = false;
  }, []);

  const requestTicket = useCallback(async () => {
    reset();
    try {
      const res = await api.post<TicketResponse>('/api/oauth/wx_qr/bind/ticket');
      setTicket(res.data);
      setState('pending');
    } catch (err) {
      setState('error');
      setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
    }
  }, [reset]);

  // Kick off when opened; clear on close.
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    void requestTicket();
  }, [open, requestTicket, reset]);

  // Finalize the clean-path bind (no merge).
  const finalizeClean = useCallback(
    async (currentTicket: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      try {
        await api.post<FinalizeResponse>('/api/oauth/wx_qr/bind/finalize', {
          ticket: currentTicket,
          confirm_merge: false,
        });
        await refresh();
        setState('done');
        toast.success(t('wechat_bind.success'));
        onOpenChange(false);
      } catch (err) {
        setState('error');
        setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
      }
    },
    [onOpenChange, refresh, t],
  );

  // User confirmed merge — fire finalize with confirm_merge=true.
  const finalizeMerge = useCallback(async () => {
    if (!ticket) return;
    setState('merging');
    try {
      const res = await api.post<FinalizeResponse>('/api/oauth/wx_qr/bind/finalize', {
        ticket: ticket.ticket,
        confirm_merge: true,
      });
      await refresh();
      setState('done');
      const addedQuota = res.data.merged_quota ?? 0;
      toast.success(t('wechat_bind.merged_toast', { quota: addedQuota }));
      onOpenChange(false);
    } catch (err) {
      setState('error');
      setError(err instanceof ApiError ? (err.backendMessage ?? err.message) : String(err));
    }
  }, [onOpenChange, refresh, t, ticket]);

  // Poll while pending.
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
        const res = await api.get<PollResponse>('/api/oauth/wx_qr/bind/poll', {
          params: { ticket: ticket.ticket },
        });
        if (cancelled) return;
        if (res.data.status === 'confirmed') {
          setState('confirmed');
          void finalizeClean(ticket.ticket);
          return;
        }
        if (res.data.status === 'merge_required') {
          setCandidate(res.data.merge_candidate ?? null);
          setState('merge_confirm');
          return;
        }
        if (res.data.status === 'expired') {
          setState('expired');
          return;
        }
      } catch {
        // transient hiccup — next tick retries
      }
    };

    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, ticket, state, finalizeClean]);

  const tip =
    state === 'pending' ? t('wechat_bind.tip_pending')
    : state === 'confirmed' ? t('wechat_bind.tip_confirmed')
    : state === 'expired' ? t('wechat_bind.tip_expired')
    : state === 'loading' ? t('wechat_bind.tip_loading')
    : t('wechat_bind.tip_error');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[400px]'>
        <DialogHeader>
          <DialogTitle>
            {state === 'merge_confirm' || state === 'merging'
              ? t('wechat_bind.merge_title')
              : t('wechat_bind.modal_title')}
          </DialogTitle>
        </DialogHeader>

        {state === 'merge_confirm' || state === 'merging' ? (
          <MergeConfirmView
            candidate={candidate}
            busy={state === 'merging'}
            onCancel={() => onOpenChange(false)}
            onConfirm={() => void finalizeMerge()}
            error={error}
            onClearError={() => setError(null)}
          />
        ) : (
          <div className='flex flex-col items-center gap-4 py-2'>
            <div className='relative flex h-[240px] w-[240px] items-center justify-center rounded-md border border-line bg-bg-1'>
              {ticket && state !== 'loading' && state !== 'error' ? (
                <img
                  src={ticket.qr_image}
                  alt='WeChat Bind QR'
                  className='h-full w-full rounded-md object-contain'
                />
              ) : (
                <span className='text-13 text-fg-2'>{tip}</span>
              )}
              {state === 'expired' && (
                <div className='absolute inset-0 flex items-center justify-center rounded-md bg-bg-1/85'>
                  <Button type='button' size='sm' onClick={() => void requestTicket()}>
                    {t('wechat_bind.refresh')}
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
                {t('wechat_bind.refresh')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeConfirmView({
  candidate,
  busy,
  onCancel,
  onConfirm,
  error,
  onClearError,
}: {
  candidate: MergeCandidate | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  error: string | null;
  onClearError: () => void;
}) {
  const { t } = useTranslation('account');
  return (
    <div className='space-y-4 py-2'>
      <p className='text-13 text-fg-1'>{t('wechat_bind.merge_intro')}</p>

      {candidate && (
        <div className='rounded-md border border-line bg-bg-1 p-3 space-y-1.5'>
          <MergeRow label={t('wechat_bind.merge_label_username')} value={candidate.username} />
          {candidate.email && (
            <MergeRow label={t('wechat_bind.merge_label_email')} value={candidate.email} />
          )}
          <MergeRow
            label={t('wechat_bind.merge_label_quota')}
            value={String(candidate.quota)}
          />
          <MergeRow
            label={t('wechat_bind.merge_label_used')}
            value={String(candidate.used_quota)}
          />
          <MergeRow
            label={t('wechat_bind.merge_label_tokens')}
            value={String(candidate.token_count)}
          />
        </div>
      )}

      <InlineBanner level='warn' message={t('wechat_bind.merge_warning')} />

      {error && <InlineBanner level='danger' message={error} onClose={onClearError} />}

      <div className='flex justify-end gap-2'>
        <Button variant='ghost' onClick={onCancel} disabled={busy}>
          {t('wechat_bind.merge_cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? t('wechat_bind.merging') : t('wechat_bind.merge_confirm')}
        </Button>
      </div>
    </div>
  );
}

function MergeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between text-13'>
      <span className='text-fg-2'>{label}</span>
      <span className='font-medium text-fg-0'>{value}</span>
    </div>
  );
}
