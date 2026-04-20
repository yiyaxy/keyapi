import { Logo } from '@/components/layout/Logo';

type Props = {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthLayout({ eyebrow, title, children, footer }: Props) {
  return (
    <div className='min-h-screen bg-bg-0 px-4 py-12'>
      <div className='mx-auto flex max-w-[400px] flex-col items-stretch'>
        <div className='mx-auto mb-6'>
          <Logo size={32} />
        </div>
        <div className='rounded-md border border-line bg-bg-1 p-6'>
          <div className='eyebrow'>{eyebrow}</div>
          <h2 className='h2 mt-2'>{title}</h2>
          <div className='mt-6'>{children}</div>
        </div>
        {footer && <div className='mt-4 text-center text-13 text-fg-1'>{footer}</div>}
      </div>
    </div>
  );
}
