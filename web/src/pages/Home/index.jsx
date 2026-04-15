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

import React, { useContext, useEffect, useState, useMemo } from 'react';
import {
  Button,
  Typography,
  ScrollList,
  ScrollItem,
  Spin,
} from '@douyinfe/semi-ui';
import { API, showError, copy, showSuccess } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { API_ENDPOINTS } from '../../constants/common.constant';
import { UPTIME_STATUS_MAP } from '../../constants/dashboard.constants';
import { StatusContext } from '../../context/Status';
import { useActualTheme } from '../../context/Theme';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import { IconPlay, IconFile, IconCopy } from '@douyinfe/semi-icons';
import { DollarSign, Shield, Activity } from 'lucide-react';
import {
  getUptimeStatusColor,
  getUptimeStatusText,
} from '../../helpers/dashboard';
import { Link } from 'react-router-dom';
import {
  Moonshot, OpenAI, XAI, Zhipu, Volcengine, Cohere, Claude,
  Gemini, Suno, Minimax, Wenxin, Spark, Qingyan, DeepSeek,
  Qwen, Midjourney, Grok, AzureAI, Hunyuan, Xinference,
} from '@lobehub/icons';

const { Text } = Typography;

const Home = () => {
  const { t, i18n } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const isMobile = useIsMobile();
  const isDemoSiteMode = statusState?.status?.demo_site_enabled || false;
  const docsLink = statusState?.status?.docs_link || '';
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;
  const endpointItems = API_ENDPOINTS.map((e) => ({ value: e }));
  const [endpointIndex, setEndpointIndex] = useState(0);
  const isChinese = i18n.language.startsWith('zh');
  const [uptimeData, setUptimeData] = useState([]);
  const [uptimeLoading, setUptimeLoading] = useState(false);

  const loadUptimeData = async () => {
    setUptimeLoading(true);
    try {
      const lang = i18n.language?.split('-')[0] || 'zh';
      let uptimeUrl = '/api/uptime/status';
      if (lang && lang !== 'zh') uptimeUrl += `?lang=${lang}`;
      const res = await API.get(uptimeUrl);
      const { success, data } = res.data;
      if (success && Array.isArray(data)) setUptimeData(data);
    } catch (e) { /* ignore */ }
    setUptimeLoading(false);
  };

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_content');
    const { success, message, data } = res.data;
    if (success) {
      let content = data;
      if (!data.startsWith('https://')) {
        content = marked.parse(data);
      }
      setHomePageContent(content);
      localStorage.setItem('home_page_content', content);
      if (data.startsWith('https://')) {
        const iframe = document.querySelector('iframe');
        if (iframe) {
          iframe.onload = () => {
            iframe.contentWindow.postMessage({ themeMode: actualTheme }, '*');
            iframe.contentWindow.postMessage({ lang: i18n.language }, '*');
          };
        }
      }
    } else {
      showError(message);
      setHomePageContent(t('加载首页内容失败'));
    }
    setHomePageContentLoaded(true);
  };

  const handleCopyBaseURL = async () => {
    const ok = await copy(serverAddress);
    if (ok) showSuccess(t('已复制到剪切板'));
  };


  useEffect(() => { displayHomePageContent(); }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setEndpointIndex((prev) => (prev + 1) % endpointItems.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [endpointItems.length]);

  useEffect(() => { loadUptimeData(); }, []);

  // 语言切换时重新加载 uptime 数据
  useEffect(() => { loadUptimeData(); }, [i18n.language]);

  const allMonitors = useMemo(() => {
    const list = [];
    uptimeData.forEach((group) => {
      (group.monitors || []).forEach((m) => list.push(m));
    });
    return list;
  }, [uptimeData]);

  const overallUptime = useMemo(() => {
    if (allMonitors.length === 0) return 0;
    const sum = allMonitors.reduce((acc, m) => acc + (m.uptime || 0), 0);
    return (sum / allMonitors.length) * 100;
  }, [allMonitors]);

  const providerIcons = [
    <Moonshot size={28} />, <OpenAI size={28} />, <XAI size={28} />,
    <Zhipu.Color size={28} />, <Volcengine.Color size={28} />,
    <Cohere.Color size={28} />, <Claude.Color size={28} />,
    <Gemini.Color size={28} />, <Suno size={28} />,
    <Minimax.Color size={28} />, <Wenxin.Color size={28} />,
    <Spark.Color size={28} />, <Qingyan.Color size={28} />,
    <DeepSeek.Color size={28} />, <Qwen.Color size={28} />,
    <Midjourney size={28} />, <Grok size={28} />,
    <AzureAI.Color size={28} />, <Hunyuan.Color size={28} />,
    <Xinference.Color size={28} />,
  ];

  return (
    <div className='w-full overflow-x-hidden'>
      {homePageContentLoaded && homePageContent === '' ? (
        <div className='w-full mt-16 h-[calc(100vh-64px-36px)] flex flex-col relative overflow-hidden'>
          {/* Backgrounds */}
          <div className='home-grid-bg' />
          <div className='hero-mesh' style={{ opacity: 0.3 }} />

          {/* Main split area */}
          <div className={`home-split flex-1 min-h-0 ${isMobile ? '' : 'items-center'}`}>
            {/* Left: Hero */}
            <div className={`flex flex-col justify-center ${isMobile ? 'flex-none' : 'w-[55%]'}`}>
              <div className='home-accent-line home-enter home-enter-d1' />

              <h1 className={`text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight home-enter home-enter-d2 ${isChinese ? 'tracking-wide' : ''}`}>
                <span className='gradient-text'>{t('heroTitle')}</span>
              </h1>

              <div className='home-enter home-enter-d3'>
                <p className='text-sm md:text-base lg:text-lg text-semi-color-text-2 mt-3 md:mt-5 max-w-xl leading-relaxed'>
                  {t('heroDesc')}
                </p>

                {/* Pills */}
                <div className='flex flex-wrap gap-3 mt-5'>
                  <span className='stat-pill !bg-amber-500/10 !border-amber-500/20'>
                    <DollarSign size={14} className='text-amber-500' />{t('heroPillPrice')}
                  </span>
                  <span className='stat-pill !bg-emerald-500/10 !border-emerald-500/20'>
                    <Shield size={14} className='text-emerald-500' />{t('heroPillStable')}
                  </span>
                </div>
              </div>

              {/* Terminal bar */}
              <div className='home-terminal-bar home-enter home-enter-d4'>
                <span className='terminal-prompt'>$</span>
                <span className='terminal-url'>{serverAddress}</span>
                <span className='terminal-endpoint'>
                  <ScrollList bodyHeight={24} style={{ border: 'unset', boxShadow: 'unset' }}>
                    <ScrollItem
                      mode='wheel'
                      cycled={true}
                      list={endpointItems}
                      selectedIndex={endpointIndex}
                      onSelect={({ index }) => setEndpointIndex(index)}
                    />
                  </ScrollList>
                </span>
                <button className='terminal-copy-btn' onClick={handleCopyBaseURL}>
                  <IconCopy size='small' />
                </button>
              </div>

              {/* CTA buttons */}
              <div className='flex flex-row gap-3 mt-6 home-enter home-enter-d5'>
                <Link to='/console'>
                  <Button
                    theme='solid'
                    type='primary'
                    size={isMobile ? 'default' : 'large'}
                    className='!rounded-3xl px-8 py-2'
                    icon={<IconPlay />}
                  >
                    {t('获取密钥')}
                  </Button>
                </Link>
                {isDemoSiteMode && statusState?.status?.version ? (
                  <Button
                    size={isMobile ? 'default' : 'large'}
                    className='!rounded-3xl px-6 py-2'
                  >
                    {statusState.status.version}
                  </Button>
                ) : (
                  docsLink && (
                    <Button
                      size={isMobile ? 'default' : 'large'}
                      className='!rounded-3xl px-6 py-2'
                      icon={<IconFile />}
                      onClick={() => window.open(docsLink, '_blank')}
                    >
                      {t('文档')}
                    </Button>
                  )
                )}
              </div>
            </div>

            {/* Right: Status Panel */}
            <div className={`glass-card home-status-panel flex flex-col overflow-hidden ${isMobile ? 'flex-none max-h-[40vh]' : 'w-[45%] max-h-full'}`}>
              {/* Uptime hero */}
              <div className='px-5 pt-5 pb-3'>
                {allMonitors.length > 0 && (
                  <div className='uptime-hero-number'>
                    {overallUptime.toFixed(1)}%
                  </div>
                )}
                <div className='flex items-center gap-2 mt-1'>
                  <Activity size={14} className='text-emerald-500' />
                  <span className='text-xs font-medium text-semi-color-text-2'>{t('systemStatus')}</span>
                </div>

                {/* Mini bar chart */}
                {allMonitors.length > 0 && (
                  <div className='status-bars mt-4'>
                    {allMonitors.map((monitor, idx) => {
                      const pct = (monitor.uptime || 0) * 100;
                      const color = getUptimeStatusColor(monitor.status, UPTIME_STATUS_MAP);
                      return (
                        <div
                          key={idx}
                          className='status-bar-item'
                          style={{ height: `${Math.max(pct * 0.48, 4)}px`, backgroundColor: color }}
                          title={`${monitor.name}: ${pct.toFixed(2)}%`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className='mx-4 border-t border-semi-color-border opacity-50' />

              {/* Monitor list */}
              <Spin spinning={uptimeLoading}>
                <div className='flex-1 overflow-y-auto px-3 py-2 scrollbar-hide'>
                  {allMonitors.length > 0 ? (
                    allMonitors.map((monitor, idx) => {
                      const pct = (monitor.uptime || 0) * 100;
                      const color = getUptimeStatusColor(monitor.status, UPTIME_STATUS_MAP);
                      return (
                        <div key={idx} className='status-row'>
                          <div className='flex items-center justify-between'>
                            <div className='flex items-center gap-2 min-w-0'>
                              <div className='status-dot' style={{ backgroundColor: color }} />
                              <span className='text-xs font-medium text-semi-color-text-0 truncate'>
                                {monitor.name}
                              </span>
                            </div>
                            <span className='text-xs font-mono font-semibold ml-2 flex-shrink-0' style={{ color }}>
                              {pct.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    !uptimeLoading && (
                      <div className='flex flex-col items-center justify-center py-10 text-semi-color-text-3'>
                        <Activity size={32} className='mb-3 opacity-30' />
                        <span className='text-sm'>{t('noMonitorData')}</span>
                      </div>
                    )
                  )}
                </div>
              </Spin>
            </div>
          </div>

          {/* Bottom: Provider marquee */}
          <div className='flex-none px-4 pb-4 pt-2'>
            <div className='border-t border-semi-color-border opacity-30 mb-4' />
            <div className='flex items-center justify-center mb-2'>
              <Text type='tertiary' className='text-xs md:text-sm font-medium tracking-wider uppercase'>
                {t('支持众多的大模型供应商')}
              </Text>
            </div>
            <div className='marquee-container max-w-4xl mx-auto'>
              <div className='marquee-track'>
                {[...Array(2)].map((_, i) => (
                  <React.Fragment key={i}>
                    {providerIcons.map((icon, j) => (
                      <div key={`${i}-${j}`} className='marquee-pill'>
                        {icon}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className='overflow-x-hidden w-full'>
          {homePageContent.startsWith('https://') ? (
            <iframe
              src={homePageContent}
              className='w-full h-screen border-none'
            />
          ) : (
            <div
              className='mt-[64px]'
              dangerouslySetInnerHTML={{ __html: homePageContent }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
