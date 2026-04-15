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

import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { RefreshCw, Search } from 'lucide-react';
import { renderQuota } from '../../helpers';

const DashboardHeader = ({
  getGreeting,
  greetingVisible,
  showSearchModal,
  refresh,
  loading,
  cacheSavings,
  onSmartCacheClick,
  t,
}) => {
  const ICON_BUTTON_CLASS = 'text-white hover:bg-opacity-80 !rounded-full';

  return (
    <div className='flex items-center justify-between mb-4'>
      <h2
        className='text-2xl font-semibold text-gray-800 transition-opacity duration-1000 ease-in-out'
        style={{ opacity: greetingVisible ? 1 : 0 }}
      >
        {getGreeting}
      </h2>
      <div className='flex gap-3'>
        {cacheSavings > 0 && (
          <div
            onClick={onSmartCacheClick}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full cursor-pointer shadow-md hover:shadow-lg transition-all duration-300 text-sm font-medium"
            style={{
              animation: 'smartcache-glow 2s ease-in-out infinite alternate',
            }}
          >
            <span style={{ fontSize: 16 }}>⚡</span>
            <span>SmartCache {t('已为您节约')} {renderQuota(cacheSavings, 3)}</span>
          </div>
        )}
        <Button
          type='tertiary'
          icon={<Search size={16} />}
          onClick={showSearchModal}
          className={`bg-green-500 hover:bg-green-600 ${ICON_BUTTON_CLASS}`}
        />
        <Button
          type='tertiary'
          icon={<RefreshCw size={16} />}
          onClick={refresh}
          loading={loading}
          className={`bg-blue-500 hover:bg-blue-600 ${ICON_BUTTON_CLASS}`}
        />
      </div>
      <style>{`
        @keyframes smartcache-glow {
          from { box-shadow: 0 0 5px rgba(16, 185, 129, 0.3); }
          to { box-shadow: 0 0 20px rgba(16, 185, 129, 0.6); }
        }
      `}</style>
    </div>
  );
};

export default DashboardHeader;
