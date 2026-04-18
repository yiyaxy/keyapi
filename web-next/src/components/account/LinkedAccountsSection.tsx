import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { User } from '@/hooks/useAuth';

type Link = { key: string; field: keyof User };

const LINKS: Link[] = [
  { key: 'github', field: 'github_id' },
  { key: 'discord', field: 'discord_id' },
  { key: 'wechat', field: 'wechat_id' },
  { key: 'oidc', field: 'oidc_id' },
  { key: 'telegram', field: 'telegram_id' },
  { key: 'linuxdo', field: 'linux_do_id' },
];

export function LinkedAccountsSection({ user }: { user: User }) {
  const { t } = useTranslation('account');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('linked.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        {LINKS.map(({ key, field }) => {
          const raw = user[field];
          const bound = typeof raw === 'string' && raw.length > 0;
          return (
            <div
              key={key}
              className='flex items-center justify-between border-b border-line py-2 last:border-b-0'
            >
              <div className='text-13 text-fg-1'>{t(`linked.${key}`)}</div>
              <Badge variant={bound ? 'default' : 'outline'}>
                {bound ? t('linked.bound') : t('linked.unbound')}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
