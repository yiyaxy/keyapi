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
import NavTree from './NavTree';
import BalanceCard from './BalanceCard';
import { useNavItems } from '../useNavItems';

export default function Sidebar({ mode }) {
  const groups = useNavItems();
  const collapsed = mode === 'rail';
  const width = collapsed ? 64 : 240;

  return (
    <aside
      className='flex flex-col bg-semi-color-bg-0 border-r border-semi-color-border'
      style={{
        width,
        transition: 'width 200ms cubic-bezier(0.2, 0, 0, 1)',
      }}
      aria-label='Sidebar'
    >
      <NavTree groups={groups} collapsed={collapsed} />
      <BalanceCard collapsed={collapsed} />
    </aside>
  );
}
