import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useTranslation } from '../lib/i18n';
import { API } from '../lib/api';

interface QuotaData {
  id: number;
  user_id: number;
  username: string;
  model_name: string;
  created_at: number;
  token_used: number;
  count: number;
  quota: number;
}

interface StatData {
  quota: number;
  rpm: number;
  tpm: number;
}

interface CostDataPoint {
  name: string;
  cost: number;
}

interface ModelDataPoint {
  name: string;
  value: number;
  color: string;
}

const Analytics: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState(7); // days

  const [costData, setCostData] = useState<CostDataPoint[]>([]);
  const [modelData, setModelData] = useState<ModelDataPoint[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [statData, setStatData] = useState<StatData>({ quota: 0, rpm: 0, tpm: 0 });

  // Fetch analytics data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const endTimestamp = Math.floor(Date.now() / 1000);
        const startTimestamp = endTimestamp - (dateRange * 24 * 60 * 60);

        // The backend limits /api/data/self to 30-day windows, so fetch in chunks.
        const quotaData: QuotaData[] = [];
        let chunkStart = startTimestamp;
        while (chunkStart < endTimestamp) {
          const chunkEnd = Math.min(chunkStart + (30 * 24 * 60 * 60) - 1, endTimestamp);
          const dataResponse = await API.get('/api/data/self', {
            params: {
              start_timestamp: chunkStart,
              end_timestamp: chunkEnd,
            },
          });
          if (!dataResponse.data.success) {
            throw new Error(dataResponse.data.message || t('ana.error'));
          }
          quotaData.push(...(dataResponse.data.data || []));
          chunkStart = chunkEnd + 1;
        }

        // Fetch stats
        const statResponse = await API.get('/api/log/self/stat', {
          params: {
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp,
          },
        });

        // Transform data for cost chart (group by day)
        const dailyData = new Map<string, { ts: number; quota: number; count: number }>();
        quotaData.forEach((item) => {
          const ts = Math.floor(item.created_at / 86400) * 86400;
          const date = new Date(ts * 1000);
          const dateKey = `${date.getMonth() + 1}/${date.getDate()}`;
          const existing = dailyData.get(dateKey) || { ts, quota: 0, count: 0 };
          dailyData.set(dateKey, {
            ts,
            quota: existing.quota + item.quota,
            count: existing.count + item.count,
          });
        });

        const chartData: CostDataPoint[] = Array.from(dailyData.entries())
          .map(([name, data]) => ({
            name,
            ts: data.ts,
            cost: data.quota / 500000,
          }))
          .sort((a: any, b: any) => a.ts - b.ts)
          .map(({ name, cost }) => ({ name, cost }));

        setCostData(chartData);

        // Calculate total cost
        const total = quotaData.reduce((sum, item) => sum + item.quota, 0) / 500000;
        setTotalCost(total);

        // Transform data for model distribution (group by model)
        const modelMap = new Map<string, { quota: number; count: number }>();
        quotaData.forEach((item) => {
          const existing = modelMap.get(item.model_name) || { quota: 0, count: 0 };
          modelMap.set(item.model_name, {
            quota: existing.quota + item.quota,
            count: existing.count + item.count,
          });
        });

        const totalCount = quotaData.reduce((sum, item) => sum + item.count, 0);
        setTotalRequests(totalCount);

        const colors = ['#10b981', '#d97706', '#3b82f6', '#6366f1', '#ec4899', '#8b5cf6'];
        const modelChartData: ModelDataPoint[] = Array.from(modelMap.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 6)
          .map(([name, data], index) => ({
            name,
            value: totalCount > 0 ? Math.round((data.count / totalCount) * 100) : 0,
            color: colors[index % colors.length],
          }));

        setModelData(modelChartData);

        if (statResponse.data.success) {
          setStatData(statResponse.data.data);
        }
      } catch (err: any) {
        console.error('Failed to fetch analytics data:', err);
        setError(err.response?.data?.message || t('ana.error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-slate-500 dark:text-slate-400">{t('ana.loading')}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header with Date Range */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{t('ana.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">{t('ana.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-dark-surface p-1 rounded-lg">
             <span className="material-symbols-outlined text-slate-400 ml-2 text-[20px]">calendar_today</span>
             <select
               className="bg-transparent border-none text-sm font-medium text-slate-700 dark:text-slate-200 focus:ring-0 cursor-pointer py-1.5 pr-8"
               value={dateRange}
               onChange={(e) => setDateRange(Number(e.target.value))}
             >
                 <option value={7}>{t('ana.range.7d')}</option>
                 <option value={30}>{t('ana.range.30d')}</option>
                 <option value={90}>{t('ana.range.90d')}</option>
             </select>
        </div>
      </div>

      {/* Row 1: Cost Analysis (Bar Chart) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('ana.cost_trend')}</h3>
                  <div className="text-2xl font-black text-slate-900 dark:text-white">${totalCost.toFixed(2)} <span className="text-xs font-medium text-slate-500 font-sans normal-case">{t('ana.total_cost')}</span></div>
              </div>
              <div className="h-[300px] w-full">
                  {costData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={costData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(value) => `$${value}`} />
                          <Tooltip
                              cursor={{fill: 'rgba(255,255,255,0.05)'}}
                              contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                          />
                          <Legend iconType="circle" />
                          <Bar dataKey="cost" name={t('ana.actual_cost')} fill="#135bec" radius={[4, 4, 0, 0]} barSize={30} />
                      </BarChart>
                  </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-400">{t('ana.no_data')}</div>
                  )}
              </div>
          </div>

          {/* Model Distribution (Pie Chart) */}
          <div className="bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border flex flex-col">
               <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{t('ana.model_dist')}</h3>
               <p className="text-sm text-slate-500 mb-6">{t('ana.based_on_reqs')}</p>
               <div className="flex-1 min-h-[250px] relative">
                    {modelData.length > 0 ? (
                    <>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={modelData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {modelData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    {/* Center Text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-3xl font-black text-slate-900 dark:text-white">{totalRequests >= 1000 ? `${(totalRequests / 1000).toFixed(1)}K` : totalRequests}</span>
                        <span className="text-xs text-slate-500 uppercase">{t('ana.reqs')}</span>
                    </div>
                    </>
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-400">{t('ana.no_data')}</div>
                    )}
               </div>
               <div className="grid grid-cols-2 gap-2 mt-4">
                   {modelData.map((model) => (
                       <div key={model.name} className="flex items-center gap-2 text-xs">
                           <div className="w-2 h-2 rounded-full" style={{backgroundColor: model.color}}></div>
                           <span className="text-slate-600 dark:text-slate-300 flex-1">{model.name}</span>
                           <span className="font-mono font-medium">{model.value}%</span>
                       </div>
                   ))}
               </div>
          </div>
      </div>

      {/* Row 2: Latency & Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Stats Card (replacing latency chart with actual stats) */}
          <div className="lg:col-span-2 bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">{t('ana.stats_title')}</h3>
              <div className="grid grid-cols-2 gap-6">
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6">
                      <div className="text-sm text-slate-500 mb-2">{t('ana.total_quota')}</div>
                      <div className="text-3xl font-black text-slate-900 dark:text-white">${(statData.quota / 500000).toFixed(2)}</div>
                      <div className="text-xs text-slate-500 mt-1">{statData.quota.toLocaleString()} {t('ana.quota_unit')}</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6">
                      <div className="text-sm text-slate-500 mb-2">{t('ana.rpm_title')}</div>
                      <div className="text-3xl font-black text-slate-900 dark:text-white">{statData.rpm}</div>
                      <div className="text-xs text-slate-500 mt-1">{t('ana.avg_rpm')}</div>
                  </div>
              </div>
          </div>

          {/* Top Models List */}
          <div className="bg-white dark:bg-dark-surface rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 dark:border-dark-border">
               <div className="flex justify-between items-center mb-6">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('ana.top_consumers')}</h3>
               </div>
               <div className="space-y-4">
                   {modelData.slice(0, 5).map((item, i) => (
                       <div key={i} className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 last:border-0 last:pb-0">
                           <div>
                               <div className="text-sm font-semibold text-slate-900 dark:text-white">{item.name}</div>
                               <div className="text-xs text-slate-500">{t('ana.model_label')}</div>
                           </div>
                           <div className="text-right">
                               <div className="text-sm font-bold text-slate-900 dark:text-white">{item.value}%</div>
                               <div className="text-xs text-slate-500">{t('ana.of_requests')}</div>
                           </div>
                       </div>
                   ))}
                   {modelData.length === 0 && (
                     <div className="text-center text-slate-400 py-8">{t('ana.no_data')}</div>
                   )}
               </div>
          </div>
      </div>
    </div>
  );
};

export default Analytics;
