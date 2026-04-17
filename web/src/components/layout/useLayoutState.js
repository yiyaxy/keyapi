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

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'keyapi.sidebar.collapsed';
const BP_DRAWER = 768;
const BP_RAIL = 1024;

function readWindowWidth() {
  if (typeof window === 'undefined') return BP_RAIL;
  return window.innerWidth;
}

function computeMode(width, userCollapsed) {
  if (width < BP_DRAWER) return 'drawer';
  if (width < BP_RAIL) return 'rail';
  return userCollapsed ? 'rail' : 'expanded';
}

function readStoredCollapsed() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useLayoutState() {
  const [width, setWidth] = useState(readWindowWidth);
  const [userCollapsed, setUserCollapsed] = useState(readStoredCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setWidth(window.innerWidth), 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const mode = computeMode(width, userCollapsed);

  const toggle = useCallback(() => {
    if (width < BP_RAIL) return;
    setUserCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [width]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== '\\') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        document.activeElement?.isContentEditable
      )
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { mode, toggle, drawerOpen, setDrawerOpen };
}
