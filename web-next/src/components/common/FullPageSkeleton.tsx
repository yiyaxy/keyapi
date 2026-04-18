export function FullPageSkeleton() {
  return (
    <div
      data-testid='full-page-skeleton'
      className='flex h-screen items-center justify-center bg-bg-0 text-fg-1'
    >
      <span className='text-13'>…</span>
    </div>
  );
}
