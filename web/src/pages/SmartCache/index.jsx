import React from 'react';
import { Card } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const SmartCache = () => {
  const { t } = useTranslation();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Hero Section */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-3 mb-4">
          <span style={{ fontSize: 48 }}>⚡</span>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
            {t('SmartCache 智能缓存技术')}
          </h1>
        </div>
        <p className="text-lg text-gray-500 mt-3 max-w-2xl mx-auto">
          {t('smartcache_hero_desc')}
        </p>
      </div>

      {/* How It Works */}
      <Card className="mb-6" title={<span className="text-xl font-semibold">🔄 {t('smartcache_how_title')}</span>}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-3xl mb-2">📤</div>
            <div className="font-medium">{t('smartcache_how_step1')}</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 rounded-lg">
            <div className="text-3xl mb-2">🔍</div>
            <div className="font-medium">{t('smartcache_how_step2')}</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-3xl mb-2">✅</div>
            <div className="font-medium">{t('smartcache_how_step3_hit')}</div>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <div className="text-3xl mb-2">🔄</div>
            <div className="font-medium">{t('smartcache_how_step3_miss')}</div>
          </div>
        </div>
      </Card>

      {/* Savings Explanation */}
      <Card className="mb-6" title={<span className="text-xl font-semibold">💰 {t('smartcache_savings_title')}</span>}>
        <p className="text-gray-600 leading-relaxed">
          {t('smartcache_savings_desc')}
        </p>
      </Card>

    </div>
  );
};

export default SmartCache;
