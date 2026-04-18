import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';

export function SignOutSection() {
  const { t } = useTranslation('account');
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('signout.title')}</CardTitle>
      </CardHeader>
      <CardContent className='flex items-center justify-between'>
        <div className='text-13 text-fg-2'>{t('signout.body')}</div>
        <Button
          variant='secondary'
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          {t('signout.action')}
        </Button>
      </CardContent>
    </Card>
  );
}
