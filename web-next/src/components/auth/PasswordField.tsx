import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { className, ...rest },
  ref
) {
  const [shown, setShown] = useState(false);
  return (
    <div className={cn('relative', className)}>
      <Input ref={ref} type={shown ? 'text' : 'password'} {...rest} className='pr-9' />
      <button
        type='button'
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((v) => !v)}
        className='absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        {shown ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
    </div>
  );
});
