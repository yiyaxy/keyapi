import React, { useState, useEffect } from 'react';
import { API } from '../lib/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from '../lib/i18n';

interface KeyData {
  id: number;
  name: string;
  key?: string;
  status: number;
  created_time: number;
  accessed_time: number;
  expired_time: number;
  remain_quota: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips: string | null;
  used_quota: number;
  group: string;
  cross_group_retry: boolean;
}

interface GroupData {
  [key: string]: {
    ratio: string | number;
    desc: string;
  };
}

const ApiKeys: React.FC = () => {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<KeyData[]>([]);
  const [groups, setGroups] = useState<GroupData>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentEditId, setCurrentEditId] = useState<number | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [formData, setFormData] = useState({
    name: '',
    group: 'default',
    expired_time: -1,
    count: 1,
    remain_quota: 0,
    unlimited_quota: false,
    model_limits_enabled: false,
    model_limits: [] as string[],
    allow_ips: '',
  });
  const [quotaPerUnit, setQuotaPerUnit] = useState(500000);
  const [quotaDisplayType, setQuotaDisplayType] = useState('USD');

  // Fetch tokens on mount
  useEffect(() => {
    fetchTokens();
    fetchGroups();
    fetchModels();
    fetchStatus();
  }, []);

  const fetchTokens = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await API.get('/api/token/');
      if (response.data.success) {
        setKeys(response.data.data.items || []);
      } else {
        setError(response.data.message || t('keys.error.fetch'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('keys.error.fetch'));
      console.error('Error fetching tokens:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await API.get('/api/user/self/groups');
      if (response.data.success) {
        const groupData = response.data.data || {};
        setGroups(groupData);
        const groupKeys = Object.keys(groupData);
        if (groupKeys.length > 0 && !groupKeys.includes(formData.group)) {
          setFormData((prev) => ({ ...prev, group: groupKeys[0] }));
        }
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    }
  };

  const fetchModels = async () => {
    try {
      const response = await API.get('/api/user/self/models');
      if (response.data.success && Array.isArray(response.data.data)) {
        setAvailableModels(response.data.data);
      } else {
        setAvailableModels([]);
      }
    } catch (err) {
      console.error('Error fetching models:', err);
      setAvailableModels([]);
    }
  };

  const fetchStatus = async () => {
    try {
      const response = await API.get('/api/status');
      if (response.data?.success) {
        const statusData = response.data.data;
        if (statusData?.quota_per_unit) setQuotaPerUnit(statusData.quota_per_unit);
        if (statusData?.quota_display_type) setQuotaDisplayType(statusData.quota_display_type);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const handleOpenCreate = () => {
    setModalMode('create');
    setCurrentEditId(null);
    setFormData({
      name: '',
      group: 'default',
      expired_time: -1,
      count: 1,
      remain_quota: 0,
      unlimited_quota: false,
      model_limits_enabled: false,
      model_limits: [],
      allow_ips: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (key: KeyData) => {
    setModalMode('edit');
    setCurrentEditId(key.id);
    const modelLimitsArray = key.model_limits ? key.model_limits.split(',').filter(m => m) : [];
    setFormData({
      name: key.name,
      group: key.group || 'default',
      expired_time: key.expired_time,
      count: 1,
      remain_quota: key.remain_quota,
      unlimited_quota: key.unlimited_quota,
      model_limits_enabled: key.model_limits_enabled,
      model_limits: modelLimitsArray,
      allow_ips: key.allow_ips || '',
    });
    setIsModalOpen(true);
  };

  const handleCreateToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const createCount = Math.min(Math.max(Number(formData.count) || 1, 1), 50);

      // Create all token requests in parallel
      const tokenPromises = Array.from({ length: createCount }, (_, i) => {
        const payload = {
          name: createCount > 1 ? `${formData.name}-${i + 1}` : formData.name,
          group: formData.group,
          expired_time: formData.expired_time,
          remain_quota: formData.unlimited_quota ? -1 : formData.remain_quota,
          unlimited_quota: formData.unlimited_quota,
          model_limits_enabled: formData.model_limits_enabled,
          model_limits: formData.model_limits.join(','),
          allow_ips: formData.allow_ips || null,
        };
        return API.post('/api/token/', payload);
      });

      // Wait for all requests to complete
      const results = await Promise.allSettled(tokenPromises);

      // Count successes and failures
      const succeeded = results.filter(r =>
        r.status === 'fulfilled' && r.value.data.success
      ).length;
      const failed = createCount - succeeded;

      // Collect error messages from failed requests
      const errorMessages = results
        .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.data.success))
        .map(r => {
          if (r.status === 'rejected') {
            return r.reason?.response?.data?.message || r.reason?.message || 'Unknown error';
          } else if (r.status === 'fulfilled') {
            return r.value.data.message || t('keys.error.create');
          }
          return 'Unknown error';
        });

      // Show appropriate feedback
      if (failed > 0) {
        const uniqueErrors = [...new Set(errorMessages)];
        const errorSummary = uniqueErrors.length > 0 ? ` Errors: ${uniqueErrors.join(', ')}` : '';
        setError(`Created ${succeeded} of ${createCount} tokens successfully. ${failed} failed.${errorSummary}`);
      } else {
        setError(null);
      }

      // Close modal and refresh if at least one token was created
      if (succeeded > 0) {
        setIsModalOpen(false);
        fetchTokens();
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('keys.error.create'));
      console.error('Error creating token:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateToken = async () => {
    if (!currentEditId) return;

    setLoading(true);
    setError(null);
    try {
      const payload = {
        id: currentEditId,
        name: formData.name,
        group: formData.group,
        expired_time: formData.expired_time,
        remain_quota: formData.unlimited_quota ? -1 : formData.remain_quota,
        unlimited_quota: formData.unlimited_quota,
        model_limits_enabled: formData.model_limits_enabled,
        model_limits: formData.model_limits.join(','),
        allow_ips: formData.allow_ips || null,
      };

      const response = await API.put('/api/token/', payload);
      if (response.data.success) {
        setIsModalOpen(false);
        fetchTokens();
      } else {
        setError(response.data.message || t('keys.error.update'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('keys.error.update'));
      console.error('Error updating token:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async (id: number) => {
    if (!confirm(t('keys.delete_confirm'))) return;

    setLoading(true);
    setError(null);
    try {
      const response = await API.delete(`/api/token/${id}`);
      if (response.data.success) {
        fetchTokens();
      } else {
        setError(response.data.message || t('keys.error.delete'));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t('keys.error.delete'));
      console.error('Error deleting token:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (modalMode === 'create') {
      handleCreateToken();
    } else {
      handleUpdateToken();
    }
  };

  const handleQuickExpiration = (type: '1d' | '1w' | '1m' | 'never') => {
    if (type === 'never') {
      setFormData(prev => ({ ...prev, expired_time: -1 }));
      return;
    }

    const now = new Date();
    if (type === '1d') now.setDate(now.getDate() + 1);
    if (type === '1w') now.setDate(now.getDate() + 7);
    if (type === '1m') now.setMonth(now.getMonth() + 1);

    const timestamp = Math.floor(now.getTime() / 1000);
    setFormData(prev => ({ ...prev, expired_time: timestamp }));
  };

  const timestampToDatetimeLocal = (timestamp: number): string => {
    if (timestamp === -1) return '';
    const date = new Date(timestamp * 1000);
    const offset = date.getTimezoneOffset() * 60000;
    const localDate = new Date(date.getTime() - offset);
    return localDate.toISOString().slice(0, 16);
  };

  const datetimeLocalToTimestamp = (datetime: string): number => {
    if (!datetime) return -1;
    return Math.floor(new Date(datetime).getTime() / 1000);
  };

  const formatTimestamp = (timestamp: number): string => {
    if (timestamp === -1) return t('keys.expires.never');
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days < 0) return t('keys.expires.expired');
    if (days === 0) return t('keys.expires.today');
    if (days === 1) return t('keys.expires.tomorrow');
    if (days < 7) return t('keys.expires.in_days').replace('{0}', String(days));
    return date.toLocaleDateString();
  };

  const maskToken = (key: string): string => {
    if (!key) return 'sk-········';
    if (key.length <= 8) return 'sk-' + key.slice(0, 2) + '****' + key.slice(-2);
    return 'sk-' + key.slice(0, 4) + '**********' + key.slice(-4);
  };

  const getCurrencySymbol = (): string => {
    return quotaDisplayType === 'CNY' ? '¥' : '$';
  };

  const calculateEquivalent = (quota: number) => {
    const val = quota / quotaPerUnit;
    return val.toFixed(2);
  };

  const formatQuota = (quota: number): string => {
    if (quotaDisplayType === 'TOKENS') return quota.toLocaleString();
    const symbol = getCurrencySymbol();
    return `${symbol}${calculateEquivalent(quota)}`;
  };

  return (
    <div className="p-6 md:p-10 lg:p-14 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 dark:text-white">{t('keys.title')}</h2>
            <p className="text-slate-500 dark:text-slate-400 text-lg mt-2 max-w-2xl">{t('keys.subtitle')}</p>
        </div>
        <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white dark:bg-dark-surface border border-slate-300 dark:border-slate-700 hover:border-primary dark:hover:border-primary text-slate-900 dark:text-white font-medium transition-all hover:text-primary active:scale-95 shadow-sm"
        >
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t('keys.create')}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && keys.length === 0 && (
        <div className="text-center py-12 text-slate-500">{t('keys.loading')}</div>
      )}

      {/* Keys List */}
      {!loading || keys.length > 0 ? (
        <div className="flex flex-col border rounded-xl border-slate-200 dark:border-dark-border overflow-hidden bg-white dark:bg-dark-surface">
         {/* Table Header */}
         <div className="hidden sm:grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 dark:bg-[#1c2333] border-b border-slate-200 dark:border-dark-border text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <div className="col-span-3">{t('keys.table.details')}</div>
            <div className="col-span-3">{t('keys.table.key')}</div>
            <div className="col-span-2">{t('keys.table.used')}</div>
            <div className="col-span-2">{t('keys.table.group')}</div>
            <div className="col-span-2 text-right">{t('keys.table.actions')}</div>
         </div>

         {/* Rows */}
         {keys.map((key) => {
           const maskedKey = maskToken(key.key || '');
           const isExpiring = key.expired_time !== -1 && key.expired_time < Date.now() / 1000 + 7 * 24 * 60 * 60;

           return (
             <div key={key.id} className="group grid grid-cols-1 sm:grid-cols-12 gap-4 px-6 py-4 items-center border-b border-slate-100 dark:border-dark-border last:border-0 hover:bg-slate-50 dark:hover:bg-[#1c2333]/50 transition-colors">
                {/* Details */}
                <div className="col-span-1 sm:col-span-3 flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${key.status === 1 ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400'} shrink-0`}>
                        <span className="material-symbols-outlined text-[18px]" style={{fontVariationSettings: "'FILL' 1"}}>vpn_key</span>
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{key.name}</div>
                        <div className={`text-xs ${isExpiring ? 'text-rose-500 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
                          {formatTimestamp(key.expired_time)}
                        </div>
                    </div>
                </div>

                {/* API Key */}
                <div className="col-span-1 sm:col-span-3 font-mono text-sm flex items-center gap-2">
                    <span className="text-slate-700 dark:text-slate-300 truncate">{maskedKey}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const fullKey = 'sk-' + (key.key || '');
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(fullKey).then(() => {
                            toast.success(t('keys.copied'));
                          }).catch(() => {
                            const ta = document.createElement('textarea');
                            ta.value = fullKey;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            toast.success(t('keys.copied'));
                          });
                        } else {
                          const ta = document.createElement('textarea');
                          ta.value = fullKey;
                          ta.style.position = 'fixed';
                          ta.style.opacity = '0';
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                          toast.success(t('keys.copied'));
                        }
                      }}
                      className="p-1 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors shrink-0"
                      title={t('keys.copy')}
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    </button>
                </div>

                {/* Used */}
                <div className="col-span-1 sm:col-span-2">
                    {key.unlimited_quota ? (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center self-start px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700">
                          {t('keys.unlimited')}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {formatQuota(key.used_quota)} {t('keys.used')}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-slate-700 dark:text-slate-300 font-mono">{formatQuota(key.used_quota)} {t('keys.used')}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{formatQuota(key.remain_quota)} {t('keys.left')}</span>
                      </div>
                    )}
                </div>

                {/* Group */}
                <div className="col-span-1 sm:col-span-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {key.group || 'default'}
                    </span>
                </div>

                {/* Actions */}
                <div className="col-span-1 sm:col-span-2 flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => handleOpenEdit(key)}
                        className="p-2 text-slate-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title={t('keys.edit')}
                    >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button
                        onClick={() => handleDeleteToken(key.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                        title={t('keys.delete')}
                    >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                </div>
             </div>
           );
         })}
      </div>
      ) : null}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
            <div 
                className="bg-white dark:bg-dark-surface rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-200 dark:border-dark-border flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-dark-border flex justify-between items-center">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                        {modalMode === 'create' ? t('keys.modal.create_title') : t('keys.modal.edit_title')}
                    </h3>
                    <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-8">
                    
                    {/* Basic Info Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider border-l-4 border-primary pl-3">{t('keys.modal.basic')}</h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.name')}</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({...formData, name: e.target.value})}
                                    placeholder={t('keys.modal.name_placeholder')}
                                    className="w-full bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.group')}</label>
                                <div className="relative">
                                  <select
                                    value={formData.group}
                                    onChange={e => setFormData({...formData, group: e.target.value})}
                                    className="w-full bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                                  >
                                    {(Object.keys(groups).length > 0 ? Object.keys(groups) : ['default']).map(groupName => {
                                      const groupInfo = groups[groupName];
                                      const desc = groupInfo?.desc || '';
                                      const ratio = groupInfo?.ratio || '';
                                      const label = desc ? `${groupName} — ${desc}` : groupName;
                                      return (
                                        <option key={groupName} value={groupName}>{ratio ? `${label} (×${ratio})` : label}</option>
                                      );
                                    })}
                                  </select>
                                  {groups[formData.group] && (groups[formData.group].desc || groups[formData.group].ratio) && (
                                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                                      {groups[formData.group].desc && (
                                        <span className="text-slate-500 dark:text-slate-400">{groups[formData.group].desc}</span>
                                      )}
                                      {groups[formData.group].ratio && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                                          ×{groups[formData.group].ratio}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.expiration')}</label>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <input
                                    type="datetime-local"
                                    value={timestampToDatetimeLocal(formData.expired_time)}
                                    onChange={e => setFormData({...formData, expired_time: datetimeLocalToTimestamp(e.target.value)})}
                                    className="flex-1 bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none"
                                />
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => handleQuickExpiration('1d')} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">{t('keys.modal.exp_1d')}</button>
                                    <button type="button" onClick={() => handleQuickExpiration('1w')} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">{t('keys.modal.exp_1w')}</button>
                                    <button type="button" onClick={() => handleQuickExpiration('1m')} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">{t('keys.modal.exp_1m')}</button>
                                    <button type="button" onClick={() => handleQuickExpiration('never')} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">{t('keys.modal.exp_never')}</button>
                                </div>
                            </div>
                            <p className="text-xs text-slate-500">{t('keys.modal.exp_hint')}</p>
                        </div>

                        {modalMode === 'create' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.quantity')}</label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="number" 
                                        min="1"
                                        value={formData.count}
                                        onChange={e => setFormData({...formData, count: parseInt(e.target.value) || 1})}
                                        className="w-32 bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none"
                                    />
                                    <span className="text-xs text-slate-500">{t('keys.modal.quantity_hint')}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Quota Settings */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider border-l-4 border-primary pl-3">{t('keys.modal.quota')}</h4>
                        
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.quota_limit')}</label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.unlimited_quota}
                                        onChange={e => setFormData({...formData, unlimited_quota: e.target.checked})}
                                        className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm text-slate-600 dark:text-slate-400">{t('keys.modal.unlimited_quota')}</span>
                                </label>
                            </div>

                            {!formData.unlimited_quota && (
                                <div className="space-y-2">
                                    <input
                                        type="number"
                                        value={formData.remain_quota}
                                        onChange={e => setFormData({...formData, remain_quota: parseInt(e.target.value) || 0})}
                                        className="w-full bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none"
                                    />
                                    <p className="text-sm text-slate-500">{t('keys.modal.equivalent')} <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{getCurrencySymbol()}{calculateEquivalent(formData.remain_quota)}</span></p>
                                </div>
                            )}
                            <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
                                {t('keys.modal.quota_note')}
                            </p>
                        </div>
                    </div>

                    {/* Access Restrictions */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider border-l-4 border-primary pl-3">{t('keys.modal.access')}</h4>
                        
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.model_restrict')}</label>
                            <div className="bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg p-4 max-h-40 overflow-y-auto">
                                <div className="space-y-2">
                                    {availableModels.length === 0 && (
                                      <div className="text-xs text-slate-500">{t('keys.modal.no_models')}</div>
                                    )}
                                    <label className="flex items-center gap-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded border-b border-slate-200 dark:border-slate-700 pb-2 mb-2">
                                        <input
                                            type="checkbox"
                                            checked={formData.model_limits.length === availableModels.length}
                                            onChange={e => {
                                                if (e.target.checked) {
                                                    setFormData({...formData, model_limits_enabled: true, model_limits: [...availableModels]});
                                                } else {
                                                    setFormData({...formData, model_limits_enabled: false, model_limits: []});
                                                }
                                            }}
                                            className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('keys.modal.select_all')}</span>
                                    </label>
                                    {availableModels.map(model => (
                                        <label key={model} className="flex items-center gap-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded">
                                            <input
                                                type="checkbox"
                                                checked={formData.model_limits.includes(model)}
                                                onChange={e => {
                                                    const newLimits = e.target.checked
                                                      ? [...formData.model_limits, model]
                                                      : formData.model_limits.filter(m => m !== model);
                                                    setFormData({...formData, model_limits_enabled: newLimits.length > 0, model_limits: newLimits});
                                                }}
                                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                            />
                                            <span className="text-sm text-slate-700 dark:text-slate-300">{model}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <p className="text-xs text-slate-500">{t('keys.modal.model_hint')}</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('keys.modal.ip_whitelist')}</label>
                            <textarea
                                value={formData.allow_ips}
                                onChange={e => setFormData({...formData, allow_ips: e.target.value})}
                                placeholder={t('keys.modal.ip_placeholder')}
                                rows={3}
                                className="w-full bg-slate-50 dark:bg-[#1c2333] border border-slate-200 dark:border-dark-border rounded-lg px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 outline-none resize-none font-mono text-sm"
                            />
                            <p className="text-xs text-slate-500">{t('keys.modal.ip_hint')}</p>
                        </div>
                    </div>

                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-dark-border flex justify-end gap-3 bg-slate-50 dark:bg-[#1c2333]/50 rounded-b-2xl">
                    <button 
                        onClick={() => setIsModalOpen(false)}
                        className="px-5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        {t('keys.modal.cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !formData.name.trim()}
                        className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-medium shadow-lg shadow-primary/25 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? t('keys.modal.saving') : (modalMode === 'create' ? t('keys.modal.create_btn') : t('keys.modal.save_btn'))}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default ApiKeys;
