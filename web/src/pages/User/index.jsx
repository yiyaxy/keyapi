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
import { BarChart2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import UsersTable from '../../components/table/users';

const User = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className='mt-[60px] px-2'>
      <div className='flex justify-end mb-2'>
        <Button
          icon={<BarChart2 size={14} />}
          size='small'
          theme='light'
          onClick={() => navigate('/console/analytics')}
        >
          {t('数据分析')}
        </Button>
      </div>
      <UsersTable />
    </div>
  );
};

export default User;
