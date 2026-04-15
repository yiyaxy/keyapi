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

import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { API } from '../../helpers/api';
import UsageLogsTable from '../../components/table/usage-logs';

const Token = () => {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tradeNo = params.get('trade_no');
    const tradeStatus = params.get('trade_status');
    if (tradeNo && tradeStatus === 'TRADE_SUCCESS') {
      API.get('/api/user/epay/notify' + location.search).catch(() => {});
    }
  }, [location.search]);

  return (
    <div className='mt-[60px] px-2'>
      <UsageLogsTable />
    </div>
  );
};

export default Token;
