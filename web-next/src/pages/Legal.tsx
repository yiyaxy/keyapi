import { useTranslation } from 'react-i18next';

type Kind = 'terms' | 'privacy' | 'refund';

export function LegalPage({ kind }: { kind: Kind }) {
  const { t } = useTranslation('public');
  return (
    <article className='mx-auto max-w-2xl space-y-6'>
      <h1 className='text-24 font-semibold'>{t(`legal.${kind}.title`)}</h1>
      <p className='whitespace-pre-wrap text-14 leading-7 text-fg-1'>
        {t(`legal.${kind}.body`)}
      </p>
    </article>
  );
}
