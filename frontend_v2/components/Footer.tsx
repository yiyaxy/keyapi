import React, { useEffect, useState } from 'react';
import { useTranslation } from '../lib/i18n';

const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [footerHtml, setFooterHtml] = useState('');
  const currentYear = new Date().getFullYear();
  const systemName = localStorage.getItem('system_name') || 'CaMeL AI';

  useEffect(() => {
    const html = localStorage.getItem('footer_html');
    if (html) setFooterHtml(html);
  }, []);

  const handleNavigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('routechange'));
  };

  return (
    <footer className="w-full border-t border-slate-200 dark:border-dark-border bg-white/50 dark:bg-dark-surface/50 backdrop-blur-sm">
      {footerHtml && (
        <div className="custom-footer" dangerouslySetInnerHTML={{ __html: footerHtml }} />
      )}
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>&copy; {currentYear} {systemName}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">alternate_email</span>
          联系邮箱:
        </span>
        <a href="mailto:support@kr777.top" className="hover:text-primary transition-colors flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">mail</span>
          support@kr777.top
        </a>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">chat</span>
          QQ群号: 1080898797
        </span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <button onClick={() => handleNavigate('/privacy')} className="hover:text-primary transition-colors">{t('footer.privacy')}</button>
        <button onClick={() => handleNavigate('/terms')} className="hover:text-primary transition-colors">{t('footer.terms')}</button>
        <button onClick={() => handleNavigate('/refund')} className="hover:text-primary transition-colors">{t('footer.refund')}</button>
        <button onClick={() => handleNavigate('/pricing')} className="hover:text-primary transition-colors">{t('footer.pricing')}</button>
      </div>
      <div className="text-center py-2 text-xs text-slate-400 dark:text-slate-500">
        沪ICP备2022024740号-4
      </div>
    </footer>
  );
};

export default Footer;
