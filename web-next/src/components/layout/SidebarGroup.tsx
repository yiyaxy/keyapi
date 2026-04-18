export function SidebarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='mb-4'>
      <div className='eyebrow px-2 pb-2'>{label}</div>
      <div className='space-y-[2px]'>{children}</div>
    </div>
  );
}
