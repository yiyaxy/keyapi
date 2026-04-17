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

import React, { useContext } from 'react';
import { Avatar, Badge, Dropdown, Typography } from '@douyinfe/semi-ui';
import {
  IconBell,
  IconExit,
  IconGlobe,
  IconKey,
  IconMoon,
  IconSetting,
  IconSun,
  IconUserSetting,
  IconCreditCard,
  IconInfoCircle,
  IconFile,
} from '@douyinfe/semi-icons';
import { Monitor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserContext } from '../../../context/User';
import { StatusContext } from '../../../context/Status';
import { useTheme, useSetTheme } from '../../../context/Theme';
import { stringToColor, API, showSuccess } from '../../../helpers';
import { normalizeLanguage } from '../../../i18n/language';

// ─── Language definitions ────────────────────────────────────────────────────
const LANGS = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ja', label: '日本語' },
  { code: 'ru', label: 'Русский' },
  { code: 'vi', label: 'Tiếng Việt' },
];

// ─── Theme icon helper ────────────────────────────────────────────────────────
function ThemeIcon({ mode, size = 16 }) {
  if (mode === 'dark') return <IconMoon style={{ fontSize: size }} />;
  if (mode === 'light') return <IconSun style={{ fontSize: size }} />;
  return <Monitor size={size} />;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function UserMenu(/* { onToggleCollapse, mode } — accepted but unused */) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // User context
  const [userState, userDispatch] = useContext(UserContext);
  const user = userState?.user ?? null;

  // Status context — needed for notifications unread count
  const [statusState] = useContext(StatusContext);

  // Theme context
  const theme = useTheme(); // 'light' | 'dark' | 'auto'
  const setTheme = useSetTheme();

  // Current language
  const currentLang = normalizeLanguage(i18n.language);

  // Notification unread count (mirrors useNotifications logic)
  const announcements = statusState?.status?.announcements ?? [];
  const unreadCount = (() => {
    if (!announcements.length) return 0;
    let readKeys = [];
    try {
      readKeys = JSON.parse(localStorage.getItem('notice_read_keys')) || [];
    } catch (_) {
      readKeys = [];
    }
    const readSet = new Set(readKeys);
    const key = (a) =>
      `${a?.publishDate || ''}-${(a?.content || '').slice(0, 30)}`;
    return announcements.filter((a) => !readSet.has(key(a))).length;
  })();

  // Campaign gate: new-year (same logic as NewYearButton / useHeaderBar)
  const now = new Date();
  const isNewYear = now.getMonth() === 0 && now.getDate() === 1;

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await API.get('/api/user/logout');
    showSuccess(t('注销成功!'));
    userDispatch({ type: 'logout' });
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleTheme = (newMode) => {
    if (!['light', 'dark', 'auto'].includes(newMode)) return;
    setTheme(newMode);
  };

  const handleLang = async (lang) => {
    const previousLang = normalizeLanguage(i18n.language);
    i18n.changeLanguage(lang);
    localStorage.setItem('i18nextLng', lang);

    if (user?.id) {
      try {
        const res = await API.put('/api/user/self', { language: lang });
        if (res.data.success) {
          let settings = {};
          try {
            settings = JSON.parse(user.setting) || {};
          } catch (_) {
            settings = {};
          }
          settings.language = lang;
          const nextUser = { ...user, setting: JSON.stringify(settings) };
          userDispatch({ type: 'login', payload: nextUser });
          localStorage.setItem('user', JSON.stringify(nextUser));
        }
      } catch (_) {
        if (previousLang) {
          i18n.changeLanguage(previousLang);
          localStorage.setItem('i18nextLng', previousLang);
        }
      }
    }
  };

  // ── Sub-menu: theme ────────────────────────────────────────────────────────
  const themeMenu = (
    <Dropdown.Menu>
      {[
        { key: 'light', label: t('浅色模式') },
        { key: 'dark', label: t('深色模式') },
        { key: 'auto', label: t('自动模式') },
      ].map(({ key, label }) => (
        <Dropdown.Item
          key={key}
          icon={<ThemeIcon mode={key} />}
          onClick={() => handleTheme(key)}
          className={
            theme === key
              ? '!bg-semi-color-primary-light-default !font-semibold'
              : ''
          }
        >
          {label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  // ── Sub-menu: language ────────────────────────────────────────────────────
  const langMenu = (
    <Dropdown.Menu>
      {LANGS.map(({ code, label }) => (
        <Dropdown.Item
          key={code}
          onClick={() => handleLang(code)}
          className={
            currentLang === code
              ? '!bg-semi-color-primary-light-default !font-semibold'
              : ''
          }
        >
          {label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  // ── Main dropdown menu ─────────────────────────────────────────────────────
  const menuContent = (
    <Dropdown.Menu>
      {/* User identity header */}
      {user && (
        <>
          <div className='px-3 py-2'>
            <Typography.Text strong className='!text-sm block'>
              {user.username}
            </Typography.Text>
            <Typography.Text
              type='tertiary'
              className='!text-xs block truncate max-w-[180px]'
            >
              {user.email || ''}
            </Typography.Text>
          </div>
          <Dropdown.Divider />
        </>
      )}

      {/* Personal settings */}
      <Dropdown.Item
        icon={<IconUserSetting />}
        onClick={() => navigate('/console/personal')}
      >
        {t('个人设置')}
      </Dropdown.Item>

      {/* Token management */}
      <Dropdown.Item
        icon={<IconKey />}
        onClick={() => navigate('/console/token')}
      >
        {t('令牌管理')}
      </Dropdown.Item>

      {/* Wallet */}
      <Dropdown.Item
        icon={<IconCreditCard />}
        onClick={() => navigate('/console/topup')}
      >
        {t('钱包管理')}
      </Dropdown.Item>

      {/* Notifications — opens inbox page (modal not accessible from here) */}
      <Dropdown.Item
        icon={
          unreadCount > 0 ? (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <IconBell />
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: 'var(--semi-color-danger)',
                  color: 'var(--semi-color-white)',
                  borderRadius: '50%',
                  fontSize: 9,
                  lineHeight: '14px',
                  minWidth: 14,
                  height: 14,
                  textAlign: 'center',
                  padding: '0 2px',
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            </span>
          ) : (
            <IconBell />
          )
        }
        onClick={() => navigate('/console/inbox')}
      >
        {t('系统公告')}
      </Dropdown.Item>

      <Dropdown.Divider />

      {/* Theme sub-menu */}
      <Dropdown position='rightTop' trigger='hover' render={themeMenu}>
        <Dropdown.Item icon={<ThemeIcon mode={theme} />}>
          {t('切换主题')}
        </Dropdown.Item>
      </Dropdown>

      {/* Language sub-menu */}
      <Dropdown position='rightTop' trigger='hover' render={langMenu}>
        <Dropdown.Item icon={<IconGlobe />}>
          {t('common.changeLanguage')}
        </Dropdown.Item>
      </Dropdown>

      {/* Campaign (new-year) — only shown when gate is active */}
      {isNewYear && (
        <Dropdown.Item
          icon={<span>🎉</span>}
          onClick={() => navigate('/console/topup')}
        >
          {t('activity.current')}
        </Dropdown.Item>
      )}

      <Dropdown.Divider />

      {/* Legal / info links */}
      <Dropdown.Item
        icon={<IconInfoCircle />}
        onClick={() => navigate('/about')}
      >
        {t('关于')}
      </Dropdown.Item>

      <Dropdown.Item
        icon={<IconFile />}
        onClick={() => navigate('/user-agreement')}
      >
        {t('使用条款')}
      </Dropdown.Item>

      <Dropdown.Item
        icon={<IconFile />}
        onClick={() => navigate('/privacy-policy')}
      >
        {t('隐私政策')}
      </Dropdown.Item>

      <Dropdown.Item
        icon={<IconFile />}
        onClick={() => navigate('/refund-policy')}
      >
        {t('退款政策')}
      </Dropdown.Item>

      <Dropdown.Divider />

      {/* Sign out */}
      <Dropdown.Item icon={<IconExit />} type='danger' onClick={handleLogout}>
        {t('退出')}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  // ── Avatar trigger ─────────────────────────────────────────────────────────
  const avatarLetter = user
    ? (user.username?.[0] ?? user.email?.[0] ?? '?').toUpperCase()
    : '?';

  const avatarColor = user
    ? stringToColor(user.username || user.email || '')
    : undefined;

  // If no user, render nothing — UserMenu is only mounted when logged in
  // (Header.jsx has no conditional, but the Dropdown will still be harmless).
  return (
    <Dropdown position='bottomRight' trigger='click' render={menuContent}>
      <span
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {unreadCount > 0 ? (
          <Badge count={unreadCount} type='danger' overflowCount={99}>
            <Avatar size='small' color={avatarColor}>
              {avatarLetter}
            </Avatar>
          </Badge>
        ) : (
          <Avatar size='small' color={avatarColor}>
            {avatarLetter}
          </Avatar>
        )}
      </span>
    </Dropdown>
  );
}
