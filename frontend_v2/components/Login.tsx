import React, { useState, useEffect } from 'react';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { API, updateAPI } from '../lib/api';

interface LoginProps {
  onLogin: () => void;
  onNavigateRegister: () => void;
  onNavigateHome?: () => void;
}

const Login: React.FC<LoginProps> = ({ onLogin, onNavigateRegister, onNavigateHome }) => {
  const { t } = useTranslation();
  const { login, refreshUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<any>(null);
  const [show2FA, setShow2FA] = useState(false);
  const [code2FA, setCode2FA] = useState('');

  useEffect(() => {
    API.get('/api/status').then(res => {
      if (res.data?.data) setStatus(res.data.data);
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(username, password);
      if (result.success) {
        if (result.require2FA) {
          setShow2FA(true);
        } else {
          onLogin();
        }
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || t('auth.login_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await API.post('/api/user/login/2fa', { code: code2FA });
      const { success, message, data } = res.data;
      if (success && data) {
        localStorage.setItem('user', JSON.stringify(data));
        updateAPI();
        refreshUser();
        onLogin();
      } else {
        setError(message || t('auth.2fa_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.2fa_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-dark-bg relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl"></div>
            <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/5 blur-3xl"></div>
        </div>

      <div className="w-full max-w-md bg-white dark:bg-dark-surface rounded-2xl shadow-xl border border-slate-200 dark:border-dark-border p-8 relative z-10 animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20 mx-auto mb-4">
                {status?.logo ? <img src={status.logo} alt="Logo" className="w-8 h-8 object-contain" /> : <span className="material-symbols-outlined text-2xl">hub</span>}
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('auth.welcome_title')}</h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t('auth.sign_in_subtitle')}</p>
        </div>

        {show2FA ? (
        <form onSubmit={handle2FASubmit} className="space-y-5">
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
                    {error}
                </div>
            )}
            <div>
                <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.2fa_code')}</label>
                <input
                    type="text"
                    required
                    maxLength={6}
                    value={code2FA}
                    onChange={(e) => setCode2FA(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400 text-center tracking-[0.5em] font-mono text-lg"
                    placeholder={t('auth.2fa_placeholder')}
                    autoFocus
                />
            </div>
            <button
                type="submit"
                disabled={loading || code2FA.length !== 6}
                className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                {t('auth.verify')}
            </button>
            <button
                type="button"
                onClick={() => { setShow2FA(false); setCode2FA(''); setError(''); }}
                className="w-full text-sm text-slate-600 dark:text-slate-400 hover:text-primary font-medium"
            >
                {t('auth.back')}
            </button>
        </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
                    {error}
                </div>
            )}

            <div>
                <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.email')}</label>
                <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
                    placeholder={t('auth.email_placeholder')}
                />
            </div>

            <div>
                 <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">{t('auth.password')}</label>
                    <button type="button" className="text-xs text-primary hover:text-primary-hover font-medium">{t('auth.forgot_password')}</button>
                 </div>
                <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
                    placeholder="••••••••"
                />
            </div>

            <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                {t('auth.sign_in')}
            </button>
        </form>
        )}

        {!show2FA && (() => {
            const oauthButtons: {key: string; label: string; href: string}[] = [];
            if (status?.github_oauth) oauthButtons.push({key: 'github', label: 'GitHub', href: '/api/oauth/github'});
            if (status?.discord_oauth) oauthButtons.push({key: 'discord', label: 'Discord', href: '/api/oauth/discord'});
            if (status?.linuxdo_oauth) oauthButtons.push({key: 'linuxdo', label: 'LinuxDO', href: '/api/oauth/linuxdo'});
            if (status?.wechat_login) oauthButtons.push({key: 'wechat', label: 'WeChat', href: '/api/oauth/wechat'});
            if (status?.oidc_enabled) oauthButtons.push({key: 'oidc', label: 'SSO', href: '/api/oauth/oidc'});
            if (status?.telegram_oauth) oauthButtons.push({key: 'telegram', label: 'Telegram', href: '/api/oauth/telegram'});
            if (oauthButtons.length === 0) return null;
            return (<>
                <div className="my-8 flex items-center gap-4">
                    <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                    <span className="text-xs text-slate-400 font-medium uppercase">{t('auth.or_continue')}</span>
                    <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                </div>
                <div className={`grid gap-3 ${oauthButtons.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {oauthButtons.map(b => (
                        <a key={b.key} href={b.href} className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{b.label}</span>
                        </a>
                    ))}
                </div>
            </>);
        })()}

        <div className="mt-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
                {t('auth.no_account')} {' '}
                <button onClick={onNavigateRegister} className="text-primary font-bold hover:underline">{t('auth.sign_up')}</button>
            </p>
            {onNavigateHome && (
              <button onClick={onNavigateHome} className="mt-3 text-xs text-slate-500 hover:text-primary">
                {t('auth.back_home')}
              </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default Login;
