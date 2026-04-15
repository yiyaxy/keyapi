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

import React, { useState, useEffect } from 'react';
import { Button, Tooltip, Badge } from '@douyinfe/semi-ui';
import { Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API } from '../../../helpers';

const PlaygroundButton = ({ t, userState }) => {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userState?.user) return;

    const fetchUnreadCount = async () => {
      try {
        const res = await API.get('/api/message/unread_count');
        const { success, data } = res.data;
        if (success) {
          setUnreadCount(Number(data?.count || 0));
        }
      } catch (e) {
        // silently ignore
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [userState?.user]);

  const handleClick = () => {
    if (userState?.user) {
      navigate('/console/inbox');
    } else {
      navigate('/login');
    }
  };

  const button = (
    <Button
      icon={<Mail size={18} />}
      aria-label={t('我的消息')}
      onClick={handleClick}
      theme='borderless'
      type='tertiary'
      className='!p-1.5 !text-current focus:!bg-semi-color-fill-1 dark:focus:!bg-gray-700 !rounded-full !bg-semi-color-fill-0 dark:!bg-semi-color-fill-1 hover:!bg-semi-color-fill-1 dark:hover:!bg-semi-color-fill-2'
    />
  );

  return (
    <Tooltip content={t('我的消息')} position='bottom'>
      {unreadCount > 0 ? (
        <Badge count={unreadCount} overflowCount={99}>
          {button}
        </Badge>
      ) : (
        button
      )}
    </Tooltip>
  );
};

export default PlaygroundButton;
