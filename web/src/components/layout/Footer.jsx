import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFooterHTML, getSystemName } from '../../helpers';
import { Mail, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';

const FooterBar = () => {
  const { t } = useTranslation();
  const [footer, setFooter] = useState(getFooterHTML());
  const systemName = getSystemName();
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const footer_html = localStorage.getItem('footer_html');
    if (footer_html) setFooter(footer_html);
  }, []);

  const contactBar = (
    <footer className='w-full border-t border-semi-color-border'>
      <div className='max-w-[1110px] mx-auto px-4 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-semi-color-text-2'>
        <span>© {currentYear} {systemName}</span>
        <span className='text-semi-color-text-3'>|</span>
        <div className='flex items-center gap-1'>
          <Mail size={12} />
          <span>联系邮箱:</span>
          <a href='mailto:support@kr777.top' className='!text-semi-color-primary'>
            support@kr777.top
          </a>
        </div>
        <span className='text-semi-color-text-3'>|</span>
        <div className='flex items-center gap-1'>
          <MessageSquare size={12} />
          <span>QQ群号: 1080898797</span>
        </div>
        <span className='text-semi-color-text-3'>|</span>
        <Link to='/privacy-policy' className='!text-semi-color-text-2 hover:!text-semi-color-primary transition-colors'>
          {t('隐私政策')}
        </Link>
        <Link to='/user-agreement' className='!text-semi-color-text-2 hover:!text-semi-color-primary transition-colors'>
          {t('用户协议')}
        </Link>
        <Link to='/refund-policy' className='!text-semi-color-text-2 hover:!text-semi-color-primary transition-colors'>
          {t('退款政策')}
        </Link>
        <Link to='/plans' className='!text-semi-color-text-2 hover:!text-semi-color-primary transition-colors'>
          {t('定价')}
        </Link>
      </div>
    </footer>
  );

  return (
    <div className='w-full'>
      {footer && (
        <div className='relative'>
          <div
            className='custom-footer'
            dangerouslySetInnerHTML={{ __html: footer }}
          />
        </div>
      )}
      {contactBar}
    </div>
  );
};

export default FooterBar;
