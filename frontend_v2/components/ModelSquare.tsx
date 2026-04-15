import React, { useEffect, useMemo, useState } from 'react';
import { API } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface BackendPricing {
  model_name: string;
  description?: string;
  icon?: string;
  tags?: string;
  vendor_id?: number;
  quota_type: number;
  model_ratio: number;
  model_price: number;
  owner_by: string;
  completion_ratio: number;
  enable_groups: string[];
  supported_endpoint_types: number[];
}

interface PricingVendor {
  id: number;
  name: string;
  description?: string;
  icon?: string;
}

interface EndpointInfo {
  path: string;
  method: string;
}

interface PricingResponse {
  success: boolean;
  data: BackendPricing[];
  vendors: PricingVendor[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
  supported_endpoint: Record<string, EndpointInfo>;
}

interface PriceView {
  usedGroup: string;
  usedGroupRatio: number;
  quotaType: number;
  inputPrice?: string;
  outputPrice?: string;
  callPrice?: string;
}

const formatUSD = (value: number) => `$${value.toFixed(value >= 1 ? 4 : 6)}`;

const ModelSquare: React.FC = () => {
  const { t } = useTranslation();
  const [models, setModels] = useState<BackendPricing[]>([]);
  const [vendorsMap, setVendorsMap] = useState<Record<number, PricingVendor>>({});
  const [groupRatio, setGroupRatio] = useState<Record<string, number>>({});
  const [usableGroup, setUsableGroup] = useState<Record<string, string>>({});
  const [endpointMap, setEndpointMap] = useState<Record<string, EndpointInfo>>({});
  const [selectedModel, setSelectedModel] = useState<BackendPricing | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedQuotaType, setSelectedQuotaType] = useState<string>('all');
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPricing();
  }, []);

  const getVendorName = (model: BackendPricing) => {
    if (model.vendor_id && vendorsMap[model.vendor_id]) {
      return vendorsMap[model.vendor_id].name;
    }
    return model.owner_by || t('models.unknown_vendor');
  };

  const getModelTags = (model: BackendPricing) =>
    (model.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

  const getEffectiveGroup = (model: BackendPricing, group: string) => {
    if (group !== 'all') {
      return {
        usedGroup: group,
        usedGroupRatio: groupRatio[group] ?? 1,
      };
    }

    if (!Array.isArray(model.enable_groups) || model.enable_groups.length === 0) {
      return { usedGroup: 'default', usedGroupRatio: 1 };
    }

    let usedGroup = model.enable_groups[0];
    let usedGroupRatio = groupRatio[usedGroup] ?? 1;

    model.enable_groups.forEach((candidate) => {
      const ratio = groupRatio[candidate] ?? 1;
      if (ratio < usedGroupRatio) {
        usedGroup = candidate;
        usedGroupRatio = ratio;
      }
    });

    return { usedGroup, usedGroupRatio };
  };

  const getModelPriceView = (model: BackendPricing): PriceView => {
    const { usedGroup, usedGroupRatio } = getEffectiveGroup(model, selectedGroup);

    if (model.quota_type === 0) {
      // Backend pricing: model_ratio = 1 means $0.002 / 1K tokens
      // To convert to $ / 1M tokens: model_ratio * $0.002 * 1000 = model_ratio * $2
      // See: setting/ratio_setting/model_ratio.go line 24-25
      const inputUSD = model.model_ratio * 2 * usedGroupRatio;
      const outputUSD = model.model_ratio * model.completion_ratio * 2 * usedGroupRatio;
      return {
        usedGroup,
        usedGroupRatio,
        quotaType: model.quota_type,
        inputPrice: formatUSD(inputUSD),
        outputPrice: formatUSD(outputUSD),
      };
    }

    if (model.quota_type === 1) {
      const callUSD = model.model_price * usedGroupRatio;
      return {
        usedGroup,
        usedGroupRatio,
        quotaType: model.quota_type,
        callPrice: formatUSD(callUSD),
      };
    }

    return {
      usedGroup,
      usedGroupRatio,
      quotaType: model.quota_type,
      callPrice: '-',
    };
  };

  const fetchPricing = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await API.get<PricingResponse>('/api/pricing');
      const { success, data, vendors, group_ratio, usable_group, supported_endpoint } = response.data;

      if (!success) {
        setError(t('models.error'));
        return;
      }

      const vendorMap: Record<number, PricingVendor> = {};
      (vendors || []).forEach((vendor) => {
        vendorMap[vendor.id] = vendor;
      });

      const sortedModels = [...(data || [])].sort((a, b) => {
        if (a.model_name.startsWith('gpt') && !b.model_name.startsWith('gpt')) return -1;
        if (!a.model_name.startsWith('gpt') && b.model_name.startsWith('gpt')) return 1;
        return a.model_name.localeCompare(b.model_name);
      });

      setModels(sortedModels);
      setVendorsMap(vendorMap);
      setGroupRatio(group_ratio || {});
      setUsableGroup(usable_group || {});
      setEndpointMap(supported_endpoint || {});
    } catch (err: any) {
      console.error('Error fetching pricing:', err);
      setError(err.response?.data?.message || t('models.error'));
    } finally {
      setLoading(false);
    }
  };

  const vendorOptions = useMemo(() => {
    const names = Array.from(new Set(models.map((model) => getVendorName(model))));
    return ['all', ...names];
  }, [models, vendorsMap]);

  const endpointOptions = useMemo(() => {
    const uniqueTypes = new Set<number>();
    models.forEach((model) => {
      (model.supported_endpoint_types || []).forEach((type) => uniqueTypes.add(type));
    });
    return Array.from(uniqueTypes).sort((a, b) => a - b);
  }, [models]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    models.forEach((model) => {
      getModelTags(model).forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [models]);

  const groupOptions = useMemo(() => {
    const fromUsable = Object.keys(usableGroup || {});
    if (fromUsable.length > 0) {
      return ['all', ...fromUsable];
    }

    const modelGroups = new Set<string>();
    models.forEach((model) => {
      (model.enable_groups || []).forEach((group) => modelGroups.add(group));
    });
    return ['all', ...Array.from(modelGroups)];
  }, [models, usableGroup]);

  const filteredModels = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();

    return models.filter((model) => {
      const vendorName = getVendorName(model);
      const tags = getModelTags(model);
      const endpointTypes = model.supported_endpoint_types || [];

      if (selectedVendor !== 'all' && vendorName !== selectedVendor) return false;
      if (selectedGroup !== 'all' && !(model.enable_groups || []).includes(selectedGroup)) return false;
      if (selectedQuotaType !== 'all' && model.quota_type !== Number(selectedQuotaType)) return false;
      if (selectedEndpoint !== 'all' && !endpointTypes.includes(Number(selectedEndpoint))) return false;
      if (selectedTag !== 'all' && !tags.some((tag) => tag.toLowerCase() === selectedTag.toLowerCase())) return false;

      if (!keyword) return true;

      return (
        model.model_name.toLowerCase().includes(keyword) ||
        (model.description || '').toLowerCase().includes(keyword) ||
        vendorName.toLowerCase().includes(keyword) ||
        tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [models, vendorsMap, selectedVendor, selectedGroup, selectedQuotaType, selectedEndpoint, selectedTag, searchValue]);

  if (loading) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">{t('models.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
          <p className="text-red-600 dark:text-red-400 font-medium">{error}</p>
          <button
            onClick={fetchPricing}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            {t('models.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-8">
      <div className="rounded-3xl border border-slate-200 dark:border-dark-border bg-gradient-to-r from-sky-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-6 md:p-8">
        <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{t('models.title')}</h1>
        <p className="text-slate-600 dark:text-slate-300 mt-2">
          {t('models.subtitle')}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-surface p-4 md:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t('models.search')}
            className="xl:col-span-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Select
            value={selectedVendor}
            options={vendorOptions}
            onChange={setSelectedVendor}
            renderOption={(value) => (value === 'all' ? t('models.all_vendors') : value)}
          />
          <Select
            value={selectedGroup}
            options={groupOptions}
            onChange={setSelectedGroup}
            renderOption={(value) => (value === 'all' ? t('models.best_group') : value)}
          />
          <Select
            value={selectedQuotaType}
            options={['all', '0', '1']}
            onChange={setSelectedQuotaType}
            renderOption={(value) => (value === 'all' ? t('models.all_billing') : value === '0' ? t('models.per_token') : t('models.per_call'))}
          />
          <Select
            value={selectedEndpoint}
            options={['all', ...endpointOptions.map((type) => String(type))]}
            onChange={setSelectedEndpoint}
            renderOption={(value) => (value === 'all' ? t('models.all_endpoints') : `Type ${value}: ${endpointMap[value]?.path || t('models.unknown_vendor')}`)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <TagButton label={t('models.all_tags')} active={selectedTag === 'all'} onClick={() => setSelectedTag('all')} />
          {tagOptions.map((tag) => (
            <TagButton key={tag} label={tag} active={selectedTag === tag} onClick={() => setSelectedTag(tag)} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredModels.length > 0 ? (
          filteredModels.map((model) => (
            <ModelCard
              key={model.model_name}
              model={model}
              vendorName={getVendorName(model)}
              endpointMap={endpointMap}
              priceView={getModelPriceView(model)}
              tags={getModelTags(model)}
              onSelect={() => setSelectedModel(model)}
            />
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500 dark:text-slate-400">{t('models.empty')}</div>
        )}
      </div>

      {selectedModel && (
        <ModelDetailModal
          model={selectedModel}
          tags={getModelTags(selectedModel)}
          vendorName={getVendorName(selectedModel)}
          endpointMap={endpointMap}
          priceView={getModelPriceView(selectedModel)}
          onClose={() => setSelectedModel(null)}
        />
      )}
    </div>
  );
};

const Select = ({
  value,
  options,
  onChange,
  renderOption,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  renderOption: (value: string) => string;
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
  >
    {options.map((option) => (
      <option key={option} value={option}>
        {renderOption(option)}
      </option>
    ))}
  </select>
);

const TagButton = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
      active
        ? 'bg-primary text-white border-primary'
        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`}
  >
    {label}
  </button>
);

const ModelCard = ({
  model,
  vendorName,
  endpointMap,
  priceView,
  tags,
  onSelect,
}: {
  model: BackendPricing;
  vendorName: string;
  endpointMap: Record<string, EndpointInfo>;
  priceView: PriceView;
  tags: string[];
  onSelect: () => void;
}) => {
  const { t } = useTranslation();
  const endpointLabels = (model.supported_endpoint_types || []).map(
    (type) => endpointMap[String(type)]?.path || `Type ${type}`,
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-2xl p-6 hover:shadow-md transition-shadow group">
      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 dark:text-white truncate">{model.model_name}</h3>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{vendorName}</p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded-full border ${
          model.quota_type === 0
            ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-700/50'
            : 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-700/50'
        }`}>
          {model.quota_type === 0 ? t('models.per_token') : t('models.per_call')}
        </span>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2 min-h-10">
        {model.description || `${vendorName} ${t('models.vendor_model')}`}
      </p>

      <div className="rounded-xl bg-slate-50 dark:bg-[#111722]/60 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
        {priceView.quotaType === 0 ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('models.input')}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{priceView.inputPrice} {t('models.per_1m')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t('models.output')}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{priceView.outputPrice} {t('models.per_1m')}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">{t('models.call_price')}</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{priceView.callPrice} {t('models.per_call_unit')}</span>
          </div>
        )}
        <div className="text-[11px] text-slate-500">
          {t('models.group_label')} <span className="font-mono">{priceView.usedGroup}</span> ({priceView.usedGroupRatio}x)
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {endpointLabels.slice(0, 2).map((endpoint) => (
          <span key={endpoint} className="text-[10px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {endpoint}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-[10px] px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            {tag}
          </span>
        ))}
      </div>

      <button
        onClick={onSelect}
        className="mt-auto pt-4 w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        {t('models.view_details')}
      </button>
    </div>
  );
};

const ModelDetailModal = ({
  model,
  tags,
  vendorName,
  endpointMap,
  priceView,
  onClose,
}: {
  model: BackendPricing;
  tags: string[];
  vendorName: string;
  endpointMap: Record<string, EndpointInfo>;
  priceView: PriceView;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const endpoints = (model.supported_endpoint_types || []).map((type) => endpointMap[String(type)]?.path || `Type ${type}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-dark-surface rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-slate-200 dark:border-dark-border max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{model.model_name}</h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1">{vendorName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide mb-2">{t('models.description')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{model.description || '-'}</p>
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-dark-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide">{t('models.pricing_usd')}</h3>
            {priceView.quotaType === 0 ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{t('models.input')}</span>
                  <span className="font-mono text-slate-900 dark:text-white">{priceView.inputPrice} {t('models.per_1m')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{t('models.output')}</span>
                  <span className="font-mono text-slate-900 dark:text-white">{priceView.outputPrice} {t('models.per_1m')}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('models.call_price')}</span>
                <span className="font-mono text-slate-900 dark:text-white">{priceView.callPrice} {t('models.per_call_unit')}</span>
              </div>
            )}
            <div className="text-sm text-slate-500">
              {t('models.effective_group')} <span className="font-mono text-slate-800 dark:text-slate-200">{priceView.usedGroup}</span> ({priceView.usedGroupRatio}x)
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide mb-2">{t('models.available_groups')}</h3>
            <div className="flex flex-wrap gap-2">
              {(model.enable_groups || []).length > 0 ? (
                model.enable_groups.map((group) => (
                  <span key={group} className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {group}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide mb-2">{t('models.supported_endpoints')}</h3>
            <div className="flex flex-wrap gap-2">
              {endpoints.length > 0 ? (
                endpoints.map((endpoint) => (
                  <span key={endpoint} className="text-xs px-2 py-1 rounded bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300">
                    {endpoint}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wide mb-2">{t('models.tags')}</h3>
            <div className="flex flex-wrap gap-2">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500">-</span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ModelSquare;
