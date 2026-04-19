import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  useDeleteWechatConfig,
  useTenantPaymentOrders,
  useTestWechatConfig,
  useUpdateWechatConfig,
  useWechatConfig,
  type WechatConfigView,
} from '@/hooks/useTenantPayment';
import { fmtDateSec, fmtMoney } from '@/lib/format';

type Tab = 'config' | 'orders';
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
        active
          ? 'border-primary text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}

function SecretState({ set }: { set: boolean }) {
  const { t } = useTranslation('tenantpay');
  return (
    <Badge variant={set ? 'default' : 'outline'}>
      {set ? t('secret.set') : t('secret.unset')}
    </Badge>
  );
}

function WechatConfigPanel({
  data,
}: {
  data: WechatConfigView | null;
}) {
  const { t, i18n } = useTranslation('tenantpay');
  const update = useUpdateWechatConfig();
  const test = useTestWechatConfig();
  const del = useDeleteWechatConfig();
  const lang = i18n.language;

  const [appId, setAppId] = useState(data?.app_id ?? '');
  const [mchid, setMchid] = useState(data?.mchid ?? '');
  const [serialNo, setSerialNo] = useState(data?.serial_no ?? '');
  const [enabled, setEnabled] = useState(data?.enabled ?? false);
  const [appSecret, setAppSecret] = useState('');
  const [apiv3Key, setApiv3Key] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const locked = data?.platform_locked;

  function save() {
    update.mutate(
      {
        enabled,
        app_id: appId,
        mchid,
        serial_no: serialNo,
        app_secret: appSecret || undefined,
        apiv3_key: apiv3Key || undefined,
        private_key: privateKey || undefined,
      },
      {
        onSuccess: () => {
          setAppSecret('');
          setApiv3Key('');
          setPrivateKey('');
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
      : t('test.failed', { msg: data.last_test_error || '' }) +
        ` (${when})`;
  }

  return (
    <div className='space-y-4'>
      {locked && <InlineBanner level='warn' message={t('locked.banner')} />}
      <div className='space-y-4 rounded-md border border-line bg-bg-1 p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='text-14 font-medium'>{t('form.section.public')}</h3>
          </div>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>{t('form.enabled')}</Label>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={locked}
            />
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
            <SelectItem value='subscription'>
              {t('orders.filter.type.subscription')}
            </SelectItem>
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
            <SelectItem value='pending'>
              {t('orders.filter.status.pending')}
            </SelectItem>
            <SelectItem value='paid'>{t('orders.filter.status.paid')}</SelectItem>
            <SelectItem value='refunded'>
              {t('orders.filter.status.refunded')}
            </SelectItem>
            <SelectItem value='expired'>
              {t('orders.filter.status.expired')}
            </SelectItem>
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
                <th className='px-3 py-2 font-medium'>
                  {t('orders.col.out_trade_no')}
                </th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.type')}</th>
                <th className='px-3 py-2 font-medium'>
                  {t('orders.col.amount')}
                </th>
                <th className='px-3 py-2 font-medium'>{t('orders.col.status')}</th>
                <th className='px-3 py-2 font-medium'>
                  {t('orders.col.created')}
                </th>
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
                  <td className='px-3 py-2 text-fg-1'>
                    {fmtDateSec(o.created_at)}
                  </td>
                  <td className='px-3 py-2 text-fg-1'>
                    {o.paid_at ? fmtDateSec(o.paid_at) : '—'}
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
        <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')}>
          {t('tab.orders')}
        </TabBtn>
      </div>
      {tab === 'config' ? (
        config.isPending ? (
          <Skeleton className='h-64 w-full' />
        ) : config.isError ? (
          <InlineBanner
            level='danger'
            message={String((config.error as Error).message)}
          />
        ) : (
          <WechatConfigPanel
            key={`wx-${config.data?.id ?? 'none'}-${config.data?.updated_at ?? 0}`}
            data={config.data ?? null}
          />
        )
      ) : (
        <OrdersPanel />
      )}
    </div>
  );
}
