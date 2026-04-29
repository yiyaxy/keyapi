import { Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useRevealKey } from '@/hooks/useRevealKey';

export function KeyCell({ tokenId, masked }: { tokenId: number; masked: string }) {
  const { t } = useTranslation('keys');
  const [revealed, setRevealed] = useState<string | null>(null);
  const reveal = useRevealKey(tokenId);

  useEffect(() => {
    if (!revealed) return;
    const id = setTimeout(() => setRevealed(null), 5_000);
    return () => clearTimeout(id);
  }, [revealed]);

  async function onToggle() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    try {
      const full = await reveal.mutateAsync();
      setRevealed(full);
    } catch {
      toast.error(t('reveal.failed'));
    }
  }

  async function onCopy() {
    try {
      const value = revealed ?? (await reveal.mutateAsync());
      if (!revealed) setRevealed(value);
      await navigator.clipboard.writeText(value);
      toast.success(t('reveal.copied'));
    } catch {
      toast.error(t('reveal.failed'));
    }
  }

  return (
    <div className='flex items-center gap-2 mono text-13'>
      <span>{revealed ?? masked}</span>
      <button
        type='button'
        aria-label={revealed ? 'Hide' : 'Reveal'}
        onClick={onToggle}
        className='rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
      <button
        type='button'
        aria-label={t('reveal.copy')}
        onClick={onCopy}
        className='rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        <Copy size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
