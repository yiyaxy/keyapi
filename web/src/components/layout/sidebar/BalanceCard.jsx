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
  const isDanger = quota != null && Number(quota) <= 0;

  if (collapsed) {
    return (
      <Tooltip
        position='right'
        content={
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: '0.05em' }}>
              {t('sidebar.balance.label').toUpperCase()}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {loading ? '…' : amountText}
            </div>
            <a onClick={() => navigate('/console/topup')} style={{ cursor: 'pointer' }}>
              {t('sidebar.balance.topup')} →
            </a>
          </div>
        }
      >
        <div
          className='mx-2 my-2 py-2 text-center cursor-pointer rounded-semi-border-radius-small hover:bg-semi-color-fill-0'
          onClick={() => navigate('/console/topup')}
          role='button'
          tabIndex={0}
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
      >
        {loading ? (
          <Skeleton.Title active style={{ width: 80, height: 22 }} />
        ) : (
          amountText
        )}
      </div>
      <Button theme='light' type='tertiary' block onClick={() => navigate('/console/topup')}>
        {t('sidebar.balance.topup')}
      </Button>
    </div>
  );
}
