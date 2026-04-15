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

import React, { useState, useCallback } from 'react';
import { MessageCircle, Send, Bot } from 'lucide-react';
import NewYearButton from './NewYearButton';
import PlaygroundButton from './PlaygroundButton';
import NotificationButton from './NotificationButton';
import ThemeToggle from './ThemeToggle';
import LanguageSelector from './LanguageSelector';
import UserArea from './UserArea';

const ActionButtons = ({
  isNewYear,
  unreadCount,
  onNoticeOpen,
  theme,
  onThemeToggle,
  currentLang,
  onLanguageChange,
  userState,
  isLoading,
  isMobile,
  isSelfUseMode,
  logout,
  navigate,
  t,
}) => {
  const [qqCopied, setQqCopied] = useState(false);

  const handleCopyQQ = useCallback(() => {
    navigator.clipboard.writeText('1080898797').then(() => {
      setQqCopied(true);
      setTimeout(() => setQqCopied(false), 2000);
    });
  }, []);

  return (
    <div className='flex items-center gap-2 md:gap-3'>
      {/* QQ交流群 */}
      <button
        onClick={handleCopyQQ}
        className='hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
        title='点击复制QQ群号'
      >
        <MessageCircle className='w-4 h-4' />
        <span>{qqCopied ? '已复制' : '交流群 1080898797'}</span>
      </button>

      {/* Telegram群 - 智能客服 */}
      <a
        href='https://t.me/+JluzXEwFfttjNDNl'
        target='_blank'
        rel='noopener noreferrer'
        className='hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
        title='Telegram智能客服，24小时在线'
      >
        <Bot className='w-4 h-4' />
        <span>智能客服 24h</span>
      </a>

      <NewYearButton isNewYear={isNewYear} />

      <PlaygroundButton t={t} userState={userState} />

      <NotificationButton
        unreadCount={unreadCount}
        onNoticeOpen={onNoticeOpen}
        t={t}
      />

      <ThemeToggle theme={theme} onThemeToggle={onThemeToggle} t={t} />

      <LanguageSelector
        currentLang={currentLang}
        onLanguageChange={onLanguageChange}
        t={t}
      />

      <UserArea
        userState={userState}
        isLoading={isLoading}
        isMobile={isMobile}
        isSelfUseMode={isSelfUseMode}
        logout={logout}
        navigate={navigate}
        t={t}
      />
    </div>
  );
};

export default ActionButtons;
