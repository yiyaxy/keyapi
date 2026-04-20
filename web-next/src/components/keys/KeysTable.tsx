import { useTranslation } from 'react-i18next';

import type { Token } from '@/hooks/useTokens';

import { TokenRow } from './TokenRow';

type Props = {
  items: Token[];
  onEdit: (t: Token) => void;
  onDelete: (t: Token) => void;
  onToggleStatus: (t: Token) => void;
};

export function KeysTable({ items, onEdit, onDelete, onToggleStatus }: Props) {
  const { t } = useTranslation('keys');
  return (
    <table className='w-full border-collapse'>
      <thead>
        <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
          <th className='px-4 py-2 font-medium'>{t('table.col.name')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.key')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.usage')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.created')}</th>
          <th className='px-4 py-2' />
        </tr>
      </thead>
      <tbody>
        {items.map((tkn) => (
          <TokenRow
            key={tkn.id}
            token={tkn}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleStatus={onToggleStatus}
          />
        ))}
      </tbody>
    </table>
  );
}
