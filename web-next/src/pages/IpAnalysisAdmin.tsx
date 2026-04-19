import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useBanIp,
  useIpBans,
  useIpLookup,
  useIpRecords,
  useIpUsers,
  useUnbanIp,
  type IpBan,
} from '@/hooks/useIpAdmin';
import { fmtDateSec } from '@/lib/format';

type Tab = 'lookup' | 'records' | 'bans';
const PAGE_SIZE = 20;

function SegTab({
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
        active
          ? 'border-primary text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}

function LookupPanel({
  ip,
  setIp,
}: {
  ip: string;
  setIp: (v: string) => void;
}) {
  const { t } = useTranslation('ip');
  const [input, setInput] = useState(ip);
  const lookup = useIpLookup(ip || null);
  const users = useIpUsers(ip || null);

  return (
    <div className='space-y-4'>
      <div className='flex items-end gap-2'>
        <div className='flex-1 space-y-2'>
          <Label htmlFor='ip-lookup'>{t('lookup.ip.label')}</Label>
          <Input
            id='ip-lookup'
            value={input}
            placeholder={t('lookup.ip.placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setIp(input.trim());
            }}
          />
        </div>
        <Button type='button' onClick={() => setIp(input.trim())}>
          {t('lookup.submit')}
        </Button>
      </div>
      {ip && (
        <>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-2 rounded-md border border-line bg-bg-1 p-4'>
              <div className='text-12 text-fg-2'>{t('lookup.geo')}</div>
              {lookup.isPending ? (
                <Skeleton className='h-5 w-40' />
              ) : (
                <div className='text-13'>
                  {lookup.data?.location ||
                    [lookup.data?.country, lookup.data?.region, lookup.data?.city]
                      .filter(Boolean)
                      .join(' · ') ||
                    '—'}
                </div>
              )}
              <div className='text-12 text-fg-2'>{t('lookup.isp')}</div>
              <div className='text-13'>{lookup.data?.isp || '—'}</div>
            </div>
            <div className='space-y-2 rounded-md border border-line bg-bg-1 p-4'>
              <div className='text-12 text-fg-2'>{t('lookup.login_users')}</div>
              {users.isPending ? (
                <Skeleton className='h-5 w-40' />
              ) : users.data?.login_users.length ? (
                <div className='flex flex-wrap gap-1'>
                  {users.data.login_users.map((u) => (
                    <Badge key={u.id} variant='secondary'>
                      {u.username || `#${u.id}`}
                      {u.login_count ? ` · ${u.login_count}` : ''}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className='text-12 text-fg-2'>{t('lookup.no_users')}</div>
              )}
              <div className='text-12 text-fg-2'>{t('lookup.api_users')}</div>
              {users.isPending ? (
                <Skeleton className='h-5 w-40' />
              ) : users.data?.api_users.length ? (
                <div className='flex flex-wrap gap-1'>
                  {users.data.api_users.map((u) => (
                    <Badge key={u.id} variant='outline'>
                      {u.username || `#${u.id}`}
                      {u.request_count ? ` · ${u.request_count}` : ''}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className='text-12 text-fg-2'>{t('lookup.no_users')}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecordsPanel({ ip }: { ip: string }) {
  const { t } = useTranslation('ip');
  const [page, setPage] = useState(1);
  const list = useIpRecords({ ip: ip || null, p: page, page_size: PAGE_SIZE });

  if (!ip) {
    return (
      <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
        {t('records.empty')}
      </div>
    );
  }

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className='space-y-3'>
      {list.isError && (
        <InlineBanner
          level='danger'
          message={String((list.error as Error).message)}
        />
      )}
      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('records.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('records.col.user')}</th>
                <th className='px-3 py-2 font-medium'>{t('records.col.type')}</th>
                <th className='px-3 py-2 font-medium'>
                  {t('records.col.location')}
                </th>
                <th className='px-3 py-2 font-medium'>{t('records.col.agent')}</th>
                <th className='px-3 py-2 font-medium'>{t('records.col.time')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2'>
                    {r.username || `#${r.user_id}`}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge variant='outline'>{r.login_type || '—'}</Badge>
                  </td>
                  <td className='px-3 py-2 text-fg-1'>{r.ip_location || '—'}</td>
                  <td className='max-w-[240px] truncate px-3 py-2 text-12 text-fg-2'>
                    {r.user_agent}
                  </td>
                  <td className='px-3 py-2 text-fg-1'>
                    {fmtDateSec(r.created_at)}
                  </td>
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

function BansPanel() {
  const { t } = useTranslation('ip');
  const list = useIpBans();
  const ban = useBanIp();
  const unban = useUnbanIp();
  const [ipInput, setIpInput] = useState('');
  const [reason, setReason] = useState('');
  const [expireAt, setExpireAt] = useState('0');
  const [unbanTarget, setUnbanTarget] = useState<IpBan | null>(null);

  function submit() {
    const ip = ipInput.trim();
    if (!ip) return;
    ban.mutate(
      { ip, reason, expire_at: Number(expireAt) || 0 },
      {
        onSuccess: () => {
          toast.success(t('toast.ban.success'));
          setIpInput('');
          setReason('');
          setExpireAt('0');
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  }

  const bans = list.data ?? [];

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 rounded-md border border-line bg-bg-1 p-4 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end'>
        <div className='space-y-2'>
          <Label htmlFor='ban-ip'>{t('bans.add.label')}</Label>
          <Input
            id='ban-ip'
            value={ipInput}
            placeholder={t('bans.add.placeholder')}
            onChange={(e) => setIpInput(e.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ban-reason'>{t('bans.reason.label')}</Label>
          <Input
            id='ban-reason'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ban-expire'>{t('bans.expire.label')}</Label>
          <Input
            id='ban-expire'
            type='number'
            value={expireAt}
            onChange={(e) => setExpireAt(e.target.value)}
          />
        </div>
        <Button type='button' disabled={ban.isPending} onClick={submit}>
          {t('bans.submit')}
        </Button>
      </div>
      {list.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : bans.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center text-13 text-fg-2'>
          {t('bans.empty')}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('bans.col.ip')}</th>
                <th className='px-3 py-2 font-medium'>{t('bans.col.reason')}</th>
                <th className='px-3 py-2 font-medium'>{t('bans.col.expire')}</th>
                <th className='px-3 py-2 font-medium'>{t('bans.col.created')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {bans.map((b) => (
                <tr key={b.id} className='border-b border-line text-13 hover:bg-bg-1'>
                  <td className='px-3 py-2 font-mono'>{b.ip}</td>
                  <td className='px-3 py-2 text-fg-1'>{b.reason || '—'}</td>
                  <td className='px-3 py-2 text-fg-1'>
                    {b.expire_at === 0
                      ? t('bans.expire.permanent')
                      : fmtDateSec(b.expire_at)}
                  </td>
                  <td className='px-3 py-2 text-fg-1'>{fmtDateSec(b.created_at)}</td>
                  <td className='px-3 py-2'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-danger'
                      onClick={() => setUnbanTarget(b)}
                    >
                      {t('bans.unban')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unbanTarget && (
        <ConfirmDialog
          open
          title={t('unban.title')}
          body={t('unban.body', { ip: unbanTarget.ip })}
          confirmLabel={t('unban.confirm')}
          isPending={unban.isPending}
          onOpenChange={(o) => !o && setUnbanTarget(null)}
          onConfirm={() => {
            const target = unbanTarget;
            setUnbanTarget(null);
            unban.mutate(target.ip, {
              onSuccess: () => toast.success(t('toast.unban.success')),
              onError: (e) => toast.error((e as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}

export function IpAnalysisAdminPage() {
  const { t } = useTranslation('ip');
  const [tab, setTab] = useState<Tab>('lookup');
  const [ip, setIp] = useState('');

  return (
    <div className='space-y-4'>
      <InlineBanner level='info' message={t('notice.charts')} />
      <div className='flex items-center gap-1 border-b border-line'>
        <SegTab active={tab === 'lookup'} onClick={() => setTab('lookup')}>
          {t('tab.lookup')}
        </SegTab>
        <SegTab active={tab === 'records'} onClick={() => setTab('records')}>
          {t('tab.records')}
        </SegTab>
        <SegTab active={tab === 'bans'} onClick={() => setTab('bans')}>
          {t('tab.bans')}
        </SegTab>
      </div>
      {tab === 'lookup' && <LookupPanel ip={ip} setIp={setIp} />}
      {tab === 'records' && <RecordsPanel ip={ip} />}
      {tab === 'bans' && <BansPanel />}
    </div>
  );
}
