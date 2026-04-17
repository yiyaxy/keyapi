/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useContext } from 'react';
import { Tooltip, Button, Skeleton } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../../context/User';
import { renderQuota } from '../../../helpers';

export default function BalanceCard({ collapsed }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [userState] = useContext(UserContext);
  const user = userState?.user ?? null;

  const quota = user?.quota ?? null;
  const loading = !user;

  const amountText = quota == null ? '—' : renderQuota(quota);
  // Tight guard: only redden on a genuine non-positive number; string/NaN
  // payloads stay neutral.
  const isDanger = typeof quota === 'number' && quota <= 0;

  const goToTopup = () => navigate('/console/topup');
  const onKeyActivate = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToTopup();
    }
  };

  if (collapsed) {
    return (
      <Tooltip
        position='right'
        content={t('sidebar.balance.tooltip', { amount: amountText })}
      >
        <div
          className='mx-2 my-2 py-2 text-center cursor-pointer rounded-semi-border-radius-small hover:bg-semi-color-fill-0'
          onClick={goToTopup}
          onKeyDown={onKeyActivate}
          role='button'
          tabIndex={0}
          aria-label={t('sidebar.balance.tooltip', { amount: amountText })}
          aria-busy={loading || undefined}
        >
          <div
            className={[
              'text-xs',
              isDanger ? 'text-semi-color-danger' : 'text-semi-color-text-0',
            ].join(' ')}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {loading ? '…' : amountText}
          </div>
        </div>
      </Tooltip>
    );
  }

  return (
    <div className='border-t border-semi-color-border p-3'>
      <div
        className='text-[10px] uppercase text-semi-color-text-2'
        style={{ letterSpacing: '0.05em' }}
      >
        {t('sidebar.balance.label')}
      </div>
      <div
        className={[
          'text-lg font-semibold mb-2',
          isDanger ? 'text-semi-color-danger' : 'text-semi-color-text-0',
        ].join(' ')}
        style={{ fontVariantNumeric: 'tabular-nums' }}
        aria-busy={loading || undefined}
      >
        {loading ? (
          <Skeleton.Title active style={{ width: 80, height: 22 }} />
        ) : (
          amountText
        )}
      </div>
      <Button theme='light' type='tertiary' block onClick={goToTopup}>
        {t('sidebar.balance.topup')}
      </Button>
    </div>
  );
}
