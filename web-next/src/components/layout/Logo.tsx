import { useState } from 'react';

type Props = {
  size?: number;
  url?: string;
  alt?: string;
};

export function Logo({ size = 24, url, alt = 'AllModels' }: Props) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={alt}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className='inline-block rounded-md'
      />
    );
  }
  return (
    <div
      className='inline-flex items-center justify-center rounded-md bg-primary text-primary-fg'
      style={{ width: size, height: size }}
      aria-label={alt}
    >
      <span className='font-mono text-[10px] font-semibold tracking-tight'>A·M</span>
    </div>
  );
}
