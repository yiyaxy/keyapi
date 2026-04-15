import React, { useEffect, useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { API } from '../lib/api';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate, theme, toggleTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const { user, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const allNavItems = [
    { name: t('nav.dashboard'), icon: 'dashboard', path: '/' },
    { name: t('nav.notifications'), icon: 'notifications', path: '/notifications' },
    { name: t('nav.models'), icon: 'view_cozy', path: '/models' },
    { name: t('nav.keys'), icon: 'vpn_key', path: '/keys' },
    { name: t('nav.logs'), icon: 'description', path: '/logs' },
    { name: t('nav.analytics'), icon: 'analytics', path: '/analytics' },
    { name: t('nav.plans'), icon: 'credit_card', path: '/plans' },
    { name: t('nav.allFeatures'), icon: 'apps', path: 'https://camel.kr777.top', adminOnly: true },
    { name: t('nav.settings'), icon: 'settings', path: '/settings' },
  ];
  const navItems = allNavItems.filter(item => !item.adminOnly || (user?.role ?? 0) >= 10);

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'zh' : 'en');
  };

  // Fetch unread notification count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const res = await API.get('/api/message/unread_count');
        if (res.data?.success) {
          setUnreadCount(res.data?.data?.count || 0);
        }
      } catch (error) {
        console.error('Failed to fetch unread count:', error);
      }
    };

    if (user) {
      fetchUnreadCount();
      // Poll every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const handleLogout = async () => {
    await logout();
    onNavigate('/login');
  };

  return (
    <aside className="w-64 lg:w-72 border-r border-slate-200 dark:border-dark-border bg-white dark:bg-[#111722] flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20">
          <span className="material-symbols-outlined">hub</span>
        </div>
        <div>
          <h1 className="font-bold text-slate-900 dark:text-white leading-tight">{t('nav.gateway')}</h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('nav.admin')}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = currentPath === item.path;
          const isNotifications = item.path === '/notifications';
          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.path.startsWith('http')) {
                  window.open(item.path, '_blank');
                } else {
                  onNavigate(item.path);
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative ${
                isActive
                  ? 'bg-primary/10 text-primary dark:text-white dark:bg-primary'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span
                className={`material-symbols-outlined text-[20px] transition-colors ${
                  isActive ? 'text-primary dark:text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
                }`}
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {item.icon}
              </span>
              {item.name}
              {isNotifications && unreadCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
         <button
            onClick={() => onNavigate('/help')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
              currentPath === '/help'
                ? 'bg-primary/10 text-primary dark:text-white dark:bg-primary'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
             <span
                className={`material-symbols-outlined text-[20px] transition-colors ${
                  currentPath === '/help' ? 'text-primary dark:text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
                }`}
                style={{ fontVariationSettings: currentPath === '/help' ? "'FILL' 1" : "'FILL' 0" }}
              >
                help
              </span>
              {t('nav.help')}
         </button>
      </div>

      {/* Profile Footer */}
      <div className="p-4 border-t border-slate-200 dark:border-dark-border">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group">
          {/* Controls */}
           <div className="flex gap-1 shrink-0">
                <button
                    onClick={toggleTheme}
                    className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-white dark:hover:bg-slate-700 hover:text-primary dark:hover:text-white transition-all shadow-none hover:shadow-sm"
                    title={theme === 'dark' ? t('nav.light') : t('nav.dark')}
                >
                    <span className="material-symbols-outlined text-[18px]">
                        {theme === 'dark' ? 'light_mode' : 'dark_mode'}
                    </span>
                </button>
                <button
                    onClick={toggleLanguage}
                    className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-white dark:hover:bg-slate-700 hover:text-primary dark:hover:text-white transition-all shadow-none hover:shadow-sm"
                    title={language === 'en' ? t('nav.switch_zh') : t('nav.switch_en')}
                >
                     <span className="material-symbols-outlined text-[18px]">translate</span>
                </button>
           </div>
           
           <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1"></div>

          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 p-[1.5px] shrink-0">
            <div className="w-full h-full rounded-full border border-white dark:border-[#111722] bg-slate-800 overflow-hidden">
               <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.display_name || user?.username || 'U')}&background=0D8ABC&color=fff`} alt="User" className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user?.display_name || user?.username || t('nav.user_fallback')}</p>
          </div>
          <span onClick={handleLogout} className="material-symbols-outlined text-[18px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 cursor-pointer" title={t('nav.logout')}>logout</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
