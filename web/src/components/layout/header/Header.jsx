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
import { useHeaderBar } from '../../../hooks/common/useHeaderBar';
import HeaderLogo from './HeaderLogo';
import TenantSwitcher from './TenantSwitcher';
import UserMenu from './UserMenu';
import MobileMenuButton from './MobileMenuButton';

export default function Header({
  mode,
  drawerOpen = false,
  onOpenDrawer,
  onToggleCollapse,
}) {
  // isMobile from the hook is viewport-based (useIsMobile / media query).
  // mode === 'drawer' is a layout-state signal from PageLayout — the two can
  // momentarily differ during a resize. We rely on the hook's isMobile for
  // rendering decisions because it reflects actual viewport truth; mode is
  // kept on the signature for UserMenu and future consumers.
  const hb = useHeaderBar({ onMobileMenuToggle: onOpenDrawer, drawerOpen });

  return (
    <header
      className='flex items-center h-14 px-4 bg-semi-color-bg-0 border-b border-semi-color-border'
      role='banner'
    >
      {hb.isMobile && hb.isConsoleRoute && (
        <MobileMenuButton
          isConsoleRoute={hb.isConsoleRoute}
          isMobile={hb.isMobile}
          drawerOpen={drawerOpen}
          collapsed={hb.collapsed}
          onToggle={onOpenDrawer}
          t={hb.t}
        />
      )}
      <HeaderLogo
        logo={hb.logo}
        logoLoaded={hb.logoLoaded}
        isLoading={hb.isLoading}
        systemName={hb.systemName}
        isSelfUseMode={hb.isSelfUseMode}
        isDemoSiteMode={hb.isDemoSiteMode}
        isMobile={hb.isMobile}
        isConsoleRoute={hb.isConsoleRoute}
        t={hb.t}
      />
      <div className='ml-3'>
        <TenantSwitcher />
      </div>
      <div className='flex-1' />
      <UserMenu onToggleCollapse={onToggleCollapse} mode={mode} />
    </header>
  );
}
