import React, { useState, useEffect } from 'react';
import { useTranslation } from '../lib/i18n';
import { API } from '../lib/api';
import type { User, ApiResponse } from '../types';

const Settings: React.FC = () => {
  const { t, language, setLanguage } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    display_name: '',
    username: '',
  });

  // Load user data on mount
  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      const response = await API.get<ApiResponse<User>>('/api/user/self');

      if (response.data.success && response.data.data) {
        const userData = response.data.data;
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        setFormData({
          display_name: userData.display_name || userData.username || '',
          username: userData.username || '',
        });
      } else {
        setError(response.data.message || t('settings.load_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('settings.load_failed'));
      console.error('Load user error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const response = await API.put<ApiResponse<User>>('/api/user/self', formData);

      if (response.data.success) {
        await loadUserData();
        setSuccessMessage(t('settings.save_success'));
      } else {
        setError(response.data.message || t('settings.save_failed'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('settings.save_failed'));
      console.error('Save user error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (user) {
      setFormData({
        display_name: user.display_name || user.username || '',
        username: user.username || '',
      });
    }
  };

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setSuccessMessage(null);
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLanguageChange = async (nextLanguage: 'en' | 'zh') => {
    if (nextLanguage === language) return;
    setLanguage(nextLanguage);
    try {
      await API.put('/api/user/self', { language: nextLanguage });
    } catch (err) {
      console.error('Failed to persist language preference:', err);
    }
  };

  const handleCopyUserId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id.toString());
      setSuccessMessage(t('settings.copied_id'));
    } catch (err) {
      setError(t('settings.copy_failed'));
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(t('settings.delete_confirm'));
    if (!confirmed) return;

    try {
      setSaving(true);
      await API.delete('/api/user/self');
      localStorage.removeItem('user');
      window.location.reload();
    } catch (err: any) {
      setError(err.response?.data?.message || t('settings.delete_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeSessions = async () => {
    try {
      setSaving(true);
      await API.post('/api/user/logout');
      localStorage.removeItem('user');
      window.location.reload();
    } catch (err: any) {
      setError(err.response?.data?.message || t('settings.revoke_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 md:p-12 max-w-5xl mx-auto flex items-center justify-center">
        <div className="text-slate-500 dark:text-slate-400">{t('settings.loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex items-end justify-between border-b border-slate-200 dark:border-dark-border pb-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">{t('settings.title')}</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settings.subtitle')}</p>
            </div>
            <div className="flex gap-3">
                <button
                  onClick={handleDiscard}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50"
                >
                  {t('settings.discard')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded shadow-sm shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {saving ? t('settings.saving') : t('settings.save')}
                </button>
            </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        {successMessage && (
          <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-900/30 rounded-lg p-4">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>
          </div>
        )}

        {/* Language Settings */}
        <section>
             <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-slate-400">language</span>
                {t('settings.language')}
            </h3>
             <div className="bg-slate-50 dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-lg p-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                     <div>
                        <h4 className="text-base font-medium text-slate-900 dark:text-white">{t('settings.lang_title')}</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settings.language.desc')}</p>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-200 dark:bg-[#111722] p-1 rounded-lg">
                        <button 
                            onClick={() => handleLanguageChange('en')}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${language === 'en' ? 'bg-white dark:bg-primary text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            {t('settings.lang_en')}
                        </button>
                         <button 
                            onClick={() => handleLanguageChange('zh')}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${language === 'zh' ? 'bg-white dark:bg-primary text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            {t('settings.lang_zh')}
                        </button>
                    </div>
                </div>
            </div>
        </section>

        {/* Profile Info */}
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-slate-400">person</span>
                {t('settings.profile')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('settings.display_name')}</label>
                    <input
                      type="text"
                      value={formData.display_name}
                      onChange={(e) => handleInputChange('display_name', e.target.value)}
                      className="w-full bg-slate-50 dark:bg-dark-surface border-0 border-b-2 border-slate-200 dark:border-dark-border focus:border-primary focus:ring-0 px-3 py-2.5 text-sm text-slate-900 dark:text-white transition-all placeholder:text-slate-400 rounded-t-sm"
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('settings.username')}</label>
                    <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 text-sm">@</span>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => handleInputChange('username', e.target.value)}
                          className="w-full bg-slate-50 dark:bg-dark-surface border-0 border-b-2 border-slate-200 dark:border-dark-border focus:border-primary focus:ring-0 pl-7 pr-3 py-2.5 text-sm text-slate-900 dark:text-white transition-all placeholder:text-slate-400 rounded-t-sm"
                        />
                    </div>
                </div>
            </div>
        </section>

        {/* Identity */}
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-200 mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-slate-400">badge</span>
                {t('settings.identity')}
            </h3>
            <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('settings.email')}</label>
                    <input
                      type="email"
                      disabled
                      value={user?.email || ''}
                      className="w-full bg-slate-100 dark:bg-[#111722] border border-slate-200 dark:border-dark-border rounded px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
                    />
                    <p className="text-[11px] text-slate-400">{t('settings.email_desc')}</p>
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('settings.userid')}</label>
                    <div className="flex items-center gap-2">
                         <code className="w-full font-mono bg-slate-100 dark:bg-[#111722] border border-slate-200 dark:border-dark-border rounded px-3 py-2.5 text-sm text-slate-600 dark:text-slate-400 select-all">
                           {user?.id || t('settings.userid_na')}
                         </code>
                         <button
                           onClick={handleCopyUserId}
                           className="p-2 text-slate-400 hover:text-primary transition-colors"
                           title={t('settings.copy_id')}
                         >
                            <span className="material-symbols-outlined text-[18px]">content_copy</span>
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-400">{t('settings.userid_desc')}</p>
                </div>
            </div>
        </section>

        {/* Danger Zone */}
        <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">warning</span>
                {t('settings.danger')}
            </h3>
            <div className="border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 rounded-lg divide-y divide-red-200 dark:divide-red-900/30">
                <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white">{t('settings.delete_account')}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.delete_desc')}</p>
                    </div>
                    <button
                        onClick={handleDeleteAccount}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors whitespace-nowrap"
                    >
                        {t('settings.delete_account')}
                    </button>
                </div>
                <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white">{t('settings.revoke')}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.revoke_desc')}</p>
                    </div>
                    <button
                        onClick={handleRevokeSessions}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-border rounded transition-colors whitespace-nowrap"
                    >
                        {t('settings.revoke_btn')}
                    </button>
                </div>
            </div>
        </section>
    </div>
  );
};

export default Settings;
