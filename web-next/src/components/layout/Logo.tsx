export function Logo({ size = 24 }: { size?: number }) {
  return (
    <div
      className='inline-flex items-center justify-center rounded-md bg-primary text-primary-fg'
      style={{ width: size, height: size }}
      aria-label='new-api'
    >
      <span className='font-mono text-[10px] font-semibold tracking-tight'>n·a</span>
    </div>
  );
}
