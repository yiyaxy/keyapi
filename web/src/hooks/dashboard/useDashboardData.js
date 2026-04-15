/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API, isAdmin, showError, timestamp2string } from '../../helpers';
import { fetchTranslation } from '../../helpers/translationCache';
import { getDefaultTime, getInitialTimestamp } from '../../helpers/dashboard';
import { TIME_OPTIONS } from '../../constants/dashboard.constants';
import { useIsMobile } from '../common/useIsMobile';
import { useMinimumLoadingTime } from '../common/useMinimumLoadingTime';

const getTodayTimestampRange = () => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    startTimestamp: Math.floor(startOfDay.getTime() / 1000),
    endTimestamp: Math.floor(endOfDay.getTime() / 1000),
  };
};

const parseCacheSavingsQuota = (payload) => {
  if (payload == null) {
    return 0;
  }

  if (typeof payload === 'number' || typeof payload === 'string') {
    return Number(payload) || 0;
  }

  return Number(
    payload.total_savings_quota ??
      payload.smartcache_savings_quota ??
      payload.totalSavingsQuota ??
      payload.smartcacheSavingsQuota ??
      0,
  );
};

export const useDashboardData = (userState, userDispatch, statusState) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const initialized = useRef(false);

  // ========== 基础状态 ==========
  const [loading, setLoading] = useState(false);
  const [greetingVisible, setGreetingVisible] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [cacheSavings, setCacheSavings] = useState(0);
  const showLoading = useMinimumLoadingTime(loading);

  // ========== 输入状态 ==========
  const [inputs, setInputs] = useState({
    username: '',
    token_name: '',
    model_name: '',
    start_timestamp: getInitialTimestamp(),
    end_timestamp: timestamp2string(new Date().getTime() / 1000 + 3600),
    channel: '',
    data_export_default_time: '',
  });

  const [dataExportDefaultTime, setDataExportDefaultTime] =
    useState(getDefaultTime());

  // ========== 数据状态 ==========
  const [quotaData, setQuotaData] = useState([]);
  const [consumeQuota, setConsumeQuota] = useState(0);
  const [consumeTokens, setConsumeTokens] = useState(0);
  const [times, setTimes] = useState(0);
  const [pieData, setPieData] = useState([{ type: 'null', value: '0' }]);
  const [lineData, setLineData] = useState([]);
  const [modelColors, setModelColors] = useState({});

  // ========== 图表状态 ==========
  const [activeChartTab, setActiveChartTab] = useState('1');

  // ========== 趋势数据 ==========
  const [trendData, setTrendData] = useState({
    balance: [],
    usedQuota: [],
    requestCount: [],
    times: [],
    consumeQuota: [],
    tokens: [],
    rpm: [],
    tpm: [],
  });

  // ========== Uptime 数据 ==========
  const [uptimeData, setUptimeData] = useState([]);
  const [uptimeLoading, setUptimeLoading] = useState(false);
  const [activeUptimeTab, setActiveUptimeTab] = useState('');
  const [translatedConsole, setTranslatedConsole] = useState(null);

  // ========== 常量 ==========
  const now = new Date();
  const isAdminUser = isAdmin();

  // ========== Panel enable flags ==========
  const apiInfoEnabled = statusState?.status?.api_info_enabled ?? true;
  const announcementsEnabled =
    statusState?.status?.announcements_enabled ?? true;
  const faqEnabled = statusState?.status?.faq_enabled ?? true;
  const uptimeEnabled = statusState?.status?.uptime_kuma_enabled ?? true;

  const hasApiInfoPanel = apiInfoEnabled;
  const hasInfoPanels = announcementsEnabled || faqEnabled || uptimeEnabled;

  // ========== Memoized Values ==========
  const timeOptions = useMemo(
    () =>
      TIME_OPTIONS.map((option) => ({
        ...option,
        label: t(option.label),
      })),
    [t],
  );

  const performanceMetrics = useMemo(() => {
    const { start_timestamp, end_timestamp } = inputs;
    const timeDiff =
      (Date.parse(end_timestamp) - Date.parse(start_timestamp)) / 60000;
    const avgRPM = isNaN(times / timeDiff)
      ? '0'
      : (times / timeDiff).toFixed(3);
    const avgTPM = isNaN(consumeTokens / timeDiff)
      ? '0'
      : (consumeTokens / timeDiff).toFixed(3);

    return { avgRPM, avgTPM, timeDiff };
  }, [times, consumeTokens, inputs.start_timestamp, inputs.end_timestamp]);

  const getGreeting = useMemo(() => {
    const hours = new Date().getHours();
    let greeting = '';

    if (hours >= 5 && hours < 12) {
      greeting = t('早上好');
    } else if (hours >= 12 && hours < 14) {
      greeting = t('中午好');
    } else if (hours >= 14 && hours < 18) {
      greeting = t('下午好');
    } else {
      greeting = t('晚上好');
    }

    const username = userState?.user?.username || '';
    return `👋${greeting}，${username}`;
  }, [t, userState?.user?.username]);

  // ========== 回调函数 ==========
  const handleInputChange = useCallback((value, name) => {
    if (name === 'data_export_default_time') {
      setDataExportDefaultTime(value);
      localStorage.setItem('data_export_default_time', value);
      return;
    }
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  }, []);

  const showSearchModal = useCallback(() => {
    setSearchModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSearchModalVisible(false);
  }, []);

  // ========== API 调用函数 ==========
  const loadCacheSavings = useCallback(async () => {
    try {
      const { startTimestamp, endTimestamp } = getTodayTimestampRange();
      const url = `/api/log/self/cache_savings?start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}`;
      const res = await API.get(url);
      const { success, data } = res.data;
      if (success && data) {
        setCacheSavings(parseCacheSavingsQuota(data));
      } else {
        setCacheSavings(0);
      }
    } catch {
      setCacheSavings(0);
    }
  }, []);

  const loadQuotaData = useCallback(async () => {
    setLoading(true);
    try {
      let url = '';
      const { start_timestamp, end_timestamp, username } = inputs;
      let localStartTimestamp = Date.parse(start_timestamp) / 1000;
      let localEndTimestamp = Date.parse(end_timestamp) / 1000;

      if (isAdminUser) {
        url = `/api/data/?username=${username}&start_timestamp=${localStartTimestamp}&end_timestamp=${localEndTimestamp}&default_time=${dataExportDefaultTime}`;
      } else {
        url = `/api/data/self/?start_timestamp=${localStartTimestamp}&end_timestamp=${localEndTimestamp}&default_time=${dataExportDefaultTime}`;
      }

      const res = await API.get(url);
      const { success, message, data } = res.data;

      if (success) {
        setQuotaData(data);
        if (data.length === 0) {
          data.push({
            count: 0,
            model_name: '无数据',
            quota: 0,
            created_at: now.getTime() / 1000,
          });
        }
        data.sort((a, b) => a.created_at - b.created_at);
        return data;
      } else {
        showError(message);
        return [];
      }
    } finally {
      setLoading(false);
    }
  }, [inputs, dataExportDefaultTime, isAdminUser, now]);

  const loadUptimeData = useCallback(async () => {
    setUptimeLoading(true);
    try {
      const lang = i18n.language?.split('-')[0] || 'zh';
      let uptimeUrl = '/api/uptime/status';
      if (lang && lang !== 'zh') uptimeUrl += `?lang=${lang}`;
      const res = await API.get(uptimeUrl);
      const { success, message, data } = res.data;
      if (success) {
        setUptimeData(data || []);
        if (data && data.length > 0 && !activeUptimeTab) {
          setActiveUptimeTab(data[0].categoryName);
        }
      } else {
        showError(message);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUptimeLoading(false);
    }
  }, [activeUptimeTab]);

  const loadTranslatedConsole = useCallback(async () => {
    const lang = i18n.language?.split('-')[0] || 'zh';
    if (lang === 'zh') {
      setTranslatedConsole(null);
      return;
    }
    try {
      const data = await fetchTranslation('/api/console/translated', lang);
      if (data) {
        setTranslatedConsole(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [i18n.language]);

  const getUserData = useCallback(async () => {
    let res = await API.get(`/api/user/self`);
    const { success, message, data } = res.data;
    if (success) {
      userDispatch({ type: 'login', payload: data });
    } else {
      showError(message);
    }
  }, [userDispatch]);

  const refresh = useCallback(async () => {
    const [data] = await Promise.all([
      loadQuotaData(),
      loadUptimeData(),
      loadCacheSavings(),
    ]);
    return data;
  }, [loadQuotaData, loadUptimeData, loadCacheSavings]);

  const handleSearchConfirm = useCallback(
    async (updateChartDataCallback) => {
      const data = await refresh();
      if (data && data.length > 0 && updateChartDataCallback) {
        updateChartDataCallback(data);
      }
      setSearchModalVisible(false);
    },
    [refresh],
  );

  // ========== Effects ==========
  useEffect(() => {
    const timer = setTimeout(() => {
      setGreetingVisible(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      getUserData();
      initialized.current = true;
    }
  }, [getUserData]);

  // ========== 语言切换时重新加载翻译数据 ==========
  useEffect(() => {
    if (initialized.current) {
      loadUptimeData();
      loadTranslatedConsole();
    }
  }, [i18n.language]);

  return {
    // 基础状态
    loading: showLoading,
    greetingVisible,
    searchModalVisible,
    cacheSavings,

    // 输入状态
    inputs,
    dataExportDefaultTime,

    // 数据状态
    quotaData,
    consumeQuota,
    setConsumeQuota,
    consumeTokens,
    setConsumeTokens,
    times,
    setTimes,
    pieData,
    setPieData,
    lineData,
    setLineData,
    modelColors,
    setModelColors,

    // 图表状态
    activeChartTab,
    setActiveChartTab,

    // 趋势数据
    trendData,
    setTrendData,

    // Uptime 数据
    uptimeData,
    uptimeLoading,
    activeUptimeTab,
    setActiveUptimeTab,
    translatedConsole,

    // 计算值
    timeOptions,
    performanceMetrics,
    getGreeting,
    isAdminUser,
    hasApiInfoPanel,
    hasInfoPanels,
    apiInfoEnabled,
    announcementsEnabled,
    faqEnabled,
    uptimeEnabled,

    // 函数
    handleInputChange,
    showSearchModal,
    handleCloseModal,
    loadQuotaData,
    loadCacheSavings,
    loadUptimeData,
    loadTranslatedConsole,
    getUserData,
    refresh,
    handleSearchConfirm,

    // 导航和翻译
    navigate,
    t,
    isMobile,
  };
};
