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

import React, { useEffect, useRef } from 'react';
import { SideSheet } from '@douyinfe/semi-ui';
import { useLocation } from 'react-router-dom';
import NavTree from './NavTree';
import BalanceCard from './BalanceCard';
import { useNavItems } from '../useNavItems';

export default function SidebarDrawer({ open, onClose }) {
  const { pathname } = useLocation();
  const groups = useNavItems();

  // Close on route change (but not on initial mount)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <SideSheet
      visible={open}
      onCancel={onClose}
      placement='left'
      width={240}
      closable={false}
      closeOnEsc
      maskClosable
      // Semi renders an empty 56px header even when closable=false + no title;
      // hide it so NavTree starts at y=0 inside the sheet.
      headerStyle={{ display: 'none' }}
      bodyStyle={{
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <NavTree groups={groups} collapsed={false} />
      <BalanceCard collapsed={false} />
    </SideSheet>
  );
}
