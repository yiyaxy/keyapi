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
import { NavLink, useLocation } from 'react-router-dom';
import { Tooltip } from '@douyinfe/semi-ui';
import * as SemiIcons from '@douyinfe/semi-icons';

function resolveIcon(name) {
  const C = SemiIcons[name];
  return C ? <C size='default' /> : null;
}

export function isDeepestMatch(pathname, item, siblings) {
  if (!pathname.startsWith(item.to)) return false;
  const longerSibling = siblings.find(
    (s) =>
      s.id !== item.id &&
      s.to.length > item.to.length &&
      pathname.startsWith(s.to),
  );
  return !longerSibling;
}

export default function NavItem({ item, siblings, collapsed }) {
  const { pathname } = useLocation();
  const active = isDeepestMatch(pathname, item, siblings);

  const classes = [
    'relative flex items-center h-8 rounded-semi-border-radius-small transition-colors',
    collapsed ? 'justify-center mx-2 px-0' : 'mx-2 pl-3 pr-2 gap-3',
    active
      ? 'bg-semi-color-fill-1 text-semi-color-text-0 font-medium'
      : 'text-semi-color-text-1 hover:bg-semi-color-fill-0',
  ].join(' ');

  const content = (
    <NavLink
      to={item.to}
      className={classes}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
    >
      {active && (
        <span
          aria-hidden='true'
          className='absolute left-0 top-1 bottom-1 w-0.5 rounded-sm bg-semi-color-primary'
        />
      )}
      <span className='flex items-center justify-center w-[18px] h-[18px] shrink-0'>
        {resolveIcon(item.icon)}
      </span>
      {!collapsed && (
        <span className='truncate text-sm transition-opacity duration-150'>
          {item.label}
        </span>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} position='right' mouseEnterDelay={300}>
        {content}
      </Tooltip>
    );
  }
  return content;
}
