import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WechatBindQrModal } from '@/components/auth/WechatBindQrModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { User } from '@/hooks/useAuth';

type Link = { key: string; field: keyof User; bindable?: boolean };

const LINKS: Link[] = [
  { key: 'github', field: 'github_id' },
  { key: 'discord', field: 'discord_id' },
  { key: 'wechat', field: 'wechat_id', bindable: true },
  { key: 'oidc', field: 'oidc_id' },
  { key: 'telegram', field: 'telegram_id' },
  { key: 'linuxdo', field: 'linux_do_id' },
];

export function LinkedAccountsSection({ user }: { user: User }) {
  const { t } = useTranslation('account');
  const [wechatBindOpen, setWechatBindOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('linked.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        {LINKS.map(({ key, field, bindable }) => {
          const raw = user[field];
          const bound = typeof raw === 'string' && raw.length > 0;
          return (
            <div
              key={key}
              className='flex items-center justify-between border-b border-line py-2 last:border-b-0'
            >
              <div className='text-13 text-fg-1'>{t(`linked.${key}`)}</div>
              <div className='flex items-center gap-2'>
                <Badge variant={bound ? 'default' : 'outline'}>
                  {bound ? t('linked.bound') : t('linked.unbound')}
                </Badge>
                {!bound && bindable && key === 'wechat' && (
                  <Button
                    size='sm'
                    variant='secondary'
                    onClick={() => setWechatBindOpen(true)}
                  >
                    {t('linked.bind')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
      <WechatBindQrModal open={wechatBindOpen} onOpenChange={setWechatBindOpen} />
    </Card>
  );
}
