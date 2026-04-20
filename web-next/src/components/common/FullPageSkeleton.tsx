export function FullPageSkeleton() {
  return (
    <div
      data-testid='full-page-skeleton'
      className='flex h-screen items-center justify-center bg-bg-0'
      aria-busy='true'
    >
      <div className='flex items-center gap-2 text-fg-2'>
        <span className='inline-block h-2 w-2 animate-pulse rounded-pill bg-fg-2' />
        <span className='text-13'>…</span>
      </div>
    </div>
  );
}
