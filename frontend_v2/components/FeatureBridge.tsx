import React from 'react';
import { useTranslation } from '../lib/i18n';

type FeatureItem = {
  title: string;
  desc: string;
  path: string;
  scope: 'all' | 'login' | 'admin';
};

const FeatureBridge: React.FC = () => {
  const { t } = useTranslation();

  const features: FeatureItem[] = [
    { title: t('bridge.channel'), desc: t('bridge.channel_desc'), path: '/console/channel', scope: 'admin' },
    { title: t('bridge.model'), desc: t('bridge.model_desc'), path: '/console/models', scope: 'admin' },
    { title: t('bridge.deploy'), desc: t('bridge.deploy_desc'), path: '/console/deployment', scope: 'admin' },
    { title: t('bridge.token'), desc: t('bridge.token_desc'), path: '/console/token', scope: 'login' },
    { title: t('bridge.log'), desc: t('bridge.log_desc'), path: '/console/log', scope: 'login' },
    { title: t('bridge.analytics'), desc: t('bridge.analytics_desc'), path: '/console/analytics', scope: 'admin' },
    { title: t('bridge.order'), desc: t('bridge.order_desc'), path: '/console/purchase', scope: 'admin' },
    { title: t('bridge.wallet'), desc: t('bridge.wallet_desc'), path: '/console/topup', scope: 'login' },
    { title: t('bridge.ip'), desc: t('bridge.ip_desc'), path: '/console/ip-analysis', scope: 'admin' },
    { title: t('bridge.prompt'), desc: t('bridge.prompt_desc'), path: '/console/prompt-rule', scope: 'admin' },
    { title: t('bridge.message'), desc: t('bridge.message_desc'), path: '/console/message', scope: 'admin' },
    { title: t('bridge.system'), desc: t('bridge.system_desc'), path: '/console/setting', scope: 'admin' },
  ];

  const scopeLabel: Record<FeatureItem['scope'], string> = {
    all: t('bridge.scope.public'),
    login: t('bridge.scope.login'),
    admin: t('bridge.scope.admin'),
  };
  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{t('bridge.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {t('bridge.subtitle')}
          </p>
        </div>
        <a
          href="/console"
          className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-hover font-medium"
        >
          {t('bridge.open_legacy')}
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {features.map((item) => (
          <div key={item.path} className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{item.title}</h3>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {scopeLabel[item.scope]}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 min-h-[44px]">{item.desc}</p>
            <div className="mt-4 flex gap-2">
              <a
                href={item.path}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium hover:border-primary hover:text-primary"
              >
                {t('bridge.open_current')}
              </a>
              <a
                href={item.path}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {t('bridge.open_new')}
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeatureBridge;
