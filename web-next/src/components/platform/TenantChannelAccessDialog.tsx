import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  usePlatformChannelAccess,
  useToggleTenantChannelAccess,
} from '@/hooks/usePlatformChannelAccess';

export function TenantChannelAccessDialog({
  open,
  tenantId,
  tenantName,
  onOpenChange,
}: {
  open: boolean;
  tenantId: number;
  tenantName: string;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const access = usePlatformChannelAccess(open ? tenantId : null);
  const toggle = useToggleTenantChannelAccess(tenantId);

  const rows = access.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[80vh] max-w-lg flex-col overflow-hidden'>
        <DialogHeader>
          <DialogTitle>
            {t('channel_access.title', { name: tenantName })}
          </DialogTitle>
        </DialogHeader>
        <p className='text-12 text-fg-2'>{t('channel_access.hint')}</p>

        <div className='-mx-6 flex-1 overflow-y-auto px-6'>
          {access.isPending ? (
            <div className='space-y-2'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-9 w-full' />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className='py-8 text-center text-13 text-fg-2'>
              {t('channel_access.empty')}
            </p>
          ) : (
            <ul className='divide-y divide-line border-y border-line'>
              {rows.map((ch) => (
                <li
                  key={ch.id}
                  className='flex items-center justify-between gap-3 py-2.5'
                >
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate text-13 font-medium text-fg-0'>
                        {ch.name || `#${ch.id}`}
                      </span>
                      {ch.status !== 1 && (
                        <Badge variant='outline' className='text-11'>
                          {t('channel_access.status.channel_disabled')}
                        </Badge>
                      )}
                    </div>
                    <div className='text-11 tabular-nums text-fg-2'>#{ch.id}</div>
                  </div>
                  <Switch
                    checked={!ch.disabled}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => {
                      toggle.mutate(
                        { channelId: ch.id, disabled: !v },
                        {
                          onError: (e) => toast.error((e as Error).message),
                        }
                      );
                    }}
                    aria-label={
                      ch.disabled
                        ? t('channel_access.aria.enable')
                        : t('channel_access.aria.disable')
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className='flex justify-end pt-2'>
          <Button variant='secondary' onClick={() => onOpenChange(false)}>
            {t('channel_access.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
