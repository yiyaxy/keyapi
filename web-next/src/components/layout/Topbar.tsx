import { TopbarSearchStub } from './TopbarSearchStub';

type Props = {
  title: string;
  action?: React.ReactNode;
};

export function Topbar({ title, action }: Props) {
  return (
    <header className='flex h-14 items-center gap-4 border-b border-line bg-bg-0 px-6'>
      <h1 className='flex-1 h3'>{title}</h1>
      <TopbarSearchStub />
      {action}
    </header>
  );
}
