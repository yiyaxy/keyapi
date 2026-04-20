import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/useCountdown';

type Props = {
  initialSeconds?: number;
  onResend: () => void | Promise<void>;
  labelKey?: string;
};

export function ResendCountdown({
  initialSeconds = 60,
  onResend,
  labelKey = 'resend.label',
}: Props) {
  const { seconds, running, start } = useCountdown();
  const { t } = useTranslation('auth');

  async function handle() {
    await onResend();
    start(initialSeconds);
  }

  if (running) {
    return (
      <span className='text-13 text-fg-2' aria-live='polite'>
        {t('resend.cooldown', { seconds })}
      </span>
    );
  }

  return (
    <button type='button' className='text-13 text-accent hover:underline' onClick={handle}>
      {t(labelKey)}
    </button>
  );
}
