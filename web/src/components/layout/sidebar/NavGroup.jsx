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
import NavItem from './NavItem';

export default function NavGroup({ group, collapsed }) {
  return (
    <div className='mt-3 first:mt-1'>
      {!collapsed && (
        <div
          className='px-3 mb-1 text-[10px] uppercase text-semi-color-text-2'
          style={{ letterSpacing: '0.08em' }}
        >
          {group.label}
        </div>
      )}
      <ul className='list-none p-0 m-0 space-y-0.5'>
        {group.items.map((it) => (
          <li key={it.id}>
            <NavItem item={it} siblings={group.items} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  );
}
