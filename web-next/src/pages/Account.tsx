import { Navigate } from 'react-router-dom';

import { LinkedAccountsSection } from '@/components/account/LinkedAccountsSection';
import { PasswordSection } from '@/components/account/PasswordSection';
import { ProfileSection } from '@/components/account/ProfileSection';
import { SignOutSection } from '@/components/account/SignOutSection';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';

export function AccountPage() {
  const { user, status } = useAuth();
  if (status === 'loading') {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-48 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    );
  }
  if (!user) {
    return <Navigate to='/login' replace />;
  }
  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <div className='space-y-4'>
        <ProfileSection user={user} />
        <PasswordSection username={user.username} />
      </div>
      <div className='space-y-4'>
        <LinkedAccountsSection user={user} />
        <SignOutSection />
      </div>
    </div>
  );
}
