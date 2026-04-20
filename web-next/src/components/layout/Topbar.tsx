import { useEffect, useRef } from 'react';

import { registerPageActionSlot } from '@/hooks/usePageAction';

import { TopbarSearchStub } from './TopbarSearchStub';

type Props = {
  title: string;
};

export function Topbar({ title }: Props) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    registerPageActionSlot(slotRef.current);
    return () => registerPageActionSlot(null);
  }, []);
  return (
    <header className='flex h-14 items-center gap-4 border-b border-line bg-bg-0 px-6'>
      <h1 className='flex-1 h3'>{title}</h1>
      <TopbarSearchStub />
      <div ref={slotRef} className='flex items-center gap-2' />
    </header>
  );
}
