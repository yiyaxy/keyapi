import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../lib/i18n';
import { API, updateAPI } from '../lib/api';
import type { RegisterParams } from '../lib/auth';

interface RegisterProps {
  onNavigateLogin: () => void;
  onNavigateHome?: () => void;
}

const Register: React.FC<RegisterProps> = ({ onNavigateLogin, onNavigateHome }) => {
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    verification_code: '',
    wechat_verification_code: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<any>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showWeChatModal, setShowWeChatModal] = useState(false);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Fetch /api/status + read ?aff= from URL -> localStorage
  useEffect(() => {
    API.get('/api/status').then(res => {
      if (res.data?.data) setStatus(res.data.data);
    }).catch(() => {});
    const aff = new URLSearchParams(window.location.search).get('aff');
    if (aff) localStorage.setItem('aff', aff);
  }, []);

  // Auto-detect if should show email form (no OAuth providers -> show email form directly)
  useEffect(() => {
    if (!status) return;
    const hasOAuth = status.github_oauth || status.discord_oauth || status.linuxdo_oauth || status.wechat_login || status.oidc_enabled || status.telegram_oauth;
    if (!hasOAuth) setShowEmailForm(true);
  }, [status]);

  // Countdown timer for verification code
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Turnstile script loading + widget rendering
  useEffect(() => {
    if (!status?.turnstile_check || !status?.turnstile_site_key) return;
    const scriptId = 'cf-turnstile-script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => renderTurnstile();
      document.head.appendChild(script);
    } else {
      renderTurnstile();
    }
    function renderTurnstile() {
      if (turnstileRef.current && (window as any).turnstile) {
        // Remove old widget if exists
        if (turnstileWidgetId.current) {
          try { (window as any).turnstile.remove(turnstileWidgetId.current); } catch {}
        }
        turnstileWidgetId.current = (window as any).turnstile.render(turnstileRef.current, {
          sitekey: status.turnstile_site_key,
          callback: (token: string) => setTurnstileToken(token),
        });
      }
    }
    return () => {
      if (turnstileWidgetId.current) {
        try { (window as any).turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, [status?.turnstile_check, status?.turnstile_site_key]);

  const sendVerificationCode = async () => {
    if (!formData.email) { setError(t('auth.email_required')); return; }
    if (status?.turnstile_check && !turnstileToken) { setError(t('auth.turnstile_wait')); return; }
    setSendingCode(true);
    try {
      const res = await API.get(`/api/verification?email=${encodeURIComponent(formData.email)}&turnstile=${turnstileToken}`);
      if (res.data.success) {
        setError('');
        setCountdown(30);
      } else {
        setError(res.data.message || t('auth.register_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.register_failed'));
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (formData.password.length < 8) { setError(t('auth.password_min_length')); return; }
    if (formData.password !== formData.confirmPassword) { setError(t('auth.password_mismatch')); return; }
    if ((status?.user_agreement_enabled || status?.privacy_policy_enabled) && !agreedToTerms) { setError(t('auth.agree_terms_required')); return; }
    if (status?.turnstile_check && !turnstileToken) { setError(t('auth.turnstile_wait')); return; }
    setLoading(true);
    try {
      const affCode = localStorage.getItem('aff') || undefined;
      const res = await API.post(
        `/api/user/register${turnstileToken ? `?turnstile=${encodeURIComponent(turnstileToken)}` : ''}`,
        {
          username: formData.name,
          password: formData.password,
          email: formData.email,
          verification_code: formData.verification_code || undefined,
          aff_code: affCode,
        } as RegisterParams
      );
      if (res.data.success) {
        onNavigateLogin();
      } else {
        setError(res.data.message || t('auth.register_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.register_failed'));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitWeChatCode = async () => {
    if (!formData.wechat_verification_code) return;
    if (status?.turnstile_check && !turnstileToken) { setError(t('auth.turnstile_wait')); return; }
    setWechatLoading(true);
    try {
      const res = await API.get(`/api/oauth/wechat?code=${formData.wechat_verification_code}`);
      if (res.data.success && res.data.data) {
        localStorage.setItem('user', JSON.stringify(res.data.data));
        updateAPI();
        setShowWeChatModal(false);
        // Navigate to dashboard after successful wechat login
        window.location.href = '/';
      } else {
        setError(res.data.message || t('auth.login_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.login_failed'));
    } finally {
      setWechatLoading(false);
    }
  };

  const renderOAuthView = () => {
    const oauthButtons: { key: string; label: string; href?: string; onClick?: () => void }[] = [];
    if (status?.github_oauth) oauthButtons.push({ key: 'github', label: 'GitHub', href: '/api/oauth/github' });
    if (status?.discord_oauth) oauthButtons.push({ key: 'discord', label: 'Discord', href: '/api/oauth/discord' });
    if (status?.linuxdo_oauth) oauthButtons.push({ key: 'linuxdo', label: 'LinuxDO', href: '/api/oauth/linuxdo' });
    if (status?.wechat_login) oauthButtons.push({ key: 'wechat', label: 'WeChat', onClick: () => setShowWeChatModal(true) });
    if (status?.oidc_enabled) oauthButtons.push({ key: 'oidc', label: 'SSO', href: '/api/oauth/oidc' });
    if (status?.telegram_oauth) oauthButtons.push({ key: 'telegram', label: 'Telegram', href: '/api/oauth/telegram' });

    if (oauthButtons.length === 0) return null;

    return (
      <div className="space-y-4">
        <div className={`grid gap-3 ${oauthButtons.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {oauthButtons.map(b => (
            b.onClick ? (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{b.label}</span>
              </button>
            ) : (
              <a
                key={b.key}
                href={b.href}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{b.label}</span>
              </a>
            )
          ))}
        </div>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
          <span className="text-xs text-slate-400 font-medium uppercase">{t('auth.or_continue')}</span>
          <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
        </div>

        <button
          type="button"
          onClick={() => setShowEmailForm(true)}
          className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">mail</span>
          {t('auth.use_email_register')}
        </button>
      </div>
    );
  };

  const renderEmailForm = () => {
    const hasOAuth = status?.github_oauth || status?.discord_oauth || status?.linuxdo_oauth || status?.wechat_login || status?.oidc_enabled || status?.telegram_oauth;

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Username */}
        <div>
          <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.full_name')}</label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
            placeholder={t('auth.name_placeholder')}
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.password')}</label>
          <input
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
            placeholder="••••••••"
          />
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.confirm_password')}</label>
          <input
            type="password"
            required
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
            placeholder="••••••••"
          />
        </div>

        {/* Email with verification code OR plain email */}
        {status?.email_verification ? (
          <>
            <div>
              <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.email')}</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="flex-1 bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
                  placeholder={t('auth.email_placeholder')}
                />
                <button
                  type="button"
                  onClick={sendVerificationCode}
                  disabled={countdown > 0 || sendingCode}
                  className="shrink-0 px-3 py-2.5 text-xs font-bold text-primary border border-primary rounded-lg hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {countdown > 0 ? t('auth.resend_in').replace('{seconds}', String(countdown)) : t('auth.send_code')}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.verification_code')}</label>
              <input
                type="text"
                value={formData.verification_code}
                onChange={(e) => setFormData({ ...formData, verification_code: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
                placeholder={t('auth.verification_code')}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">{t('auth.email')}</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400"
              placeholder={t('auth.email_placeholder')}
            />
          </div>
        )}

        {/* Terms / Privacy checkbox */}
        {(status?.user_agreement_enabled || status?.privacy_policy_enabled) && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t('auth.agree_read')}
              {status?.user_agreement_enabled && (
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mx-1">{t('auth.terms')}</a>
              )}
              {status?.user_agreement_enabled && status?.privacy_policy_enabled && t('auth.and')}
              {status?.privacy_policy_enabled && (
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mx-1">{t('auth.privacy')}</a>
              )}
            </span>
          </label>
        )}

        {/* Turnstile container */}
        {status?.turnstile_check && (
          <div ref={turnstileRef} className="flex justify-center"></div>
        )}

        {/* Register button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading || ((status?.user_agreement_enabled || status?.privacy_policy_enabled) && !agreedToTerms)}
            className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
            {t('auth.sign_up')}
          </button>
        </div>

        {/* Other registration options button (only if OAuth providers exist) */}
        {hasOAuth && (
          <>
            <div className="my-4 flex items-center gap-4">
              <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
              <span className="text-xs text-slate-400 font-medium uppercase">{t('auth.or_continue')}</span>
              <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
            </div>
            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="w-full py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {t('auth.other_options')}
            </button>
          </>
        )}
      </form>
    );
  };

  const renderWeChatModal = () => {
    if (!showWeChatModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowWeChatModal(false)}>
        <div className="bg-white dark:bg-dark-surface rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white text-center mb-4">{t('auth.wechat_login_title')}</h3>
          {status?.wechat_qrcode && (
            <img src={status.wechat_qrcode} alt="WeChat QR" className="mx-auto mb-4 rounded-lg" />
          )}
          <p className="text-xs text-slate-500 text-center mb-4">{t('auth.wechat_scan_qr')}</p>
          <input
            type="text"
            value={formData.wechat_verification_code}
            onChange={(e) => setFormData({ ...formData, wechat_verification_code: e.target.value })}
            className="w-full bg-slate-50 dark:bg-[#111722] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400 mb-4"
            placeholder={t('auth.wechat_code')}
          />
          <button
            type="button"
            onClick={onSubmitWeChatCode}
            disabled={wechatLoading}
            className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {wechatLoading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
            {t('auth.verify')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-dark-bg relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute bottom-[10%] right-[10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl"></div>
        <div className="absolute top-[10%] left-[10%] w-[400px] h-[400px] rounded-full bg-purple-600/5 blur-3xl"></div>
      </div>

      <div className="w-full max-w-md bg-white dark:bg-dark-surface rounded-2xl shadow-xl border border-slate-200 dark:border-dark-border p-8 relative z-10 animate-in slide-in-from-right-4 duration-300">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20 mx-auto mb-4">
            {status?.logo ? <img src={status.logo} alt="Logo" className="w-8 h-8 object-contain" /> : <span className="material-symbols-outlined text-2xl">hub</span>}
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('auth.welcome_title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">{t('auth.register_subtitle')}</p>
        </div>

        {/* Conditional rendering: OAuth view or email form */}
        {showEmailForm ? renderEmailForm() : renderOAuthView()}

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('auth.has_account')}{' '}
            <button onClick={onNavigateLogin} className="text-primary font-bold hover:underline">{t('auth.sign_in')}</button>
          </p>
          {onNavigateHome && (
            <button onClick={onNavigateHome} className="mt-3 text-xs text-slate-500 hover:text-primary">
              {t('auth.back_home')}
            </button>
          )}
        </div>
      </div>

      {/* WeChat Modal */}
      {renderWeChatModal()}
    </div>
  );
};

export default Register;
