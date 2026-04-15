import React, { useMemo, useState } from 'react';
import {
  Card,
  DatePicker,
  InputNumber,
  Button,
  Progress,
  Tabs,
  TabPane,
  Modal,
  Switch,
  Input,
  Table,
  Tag,
  Empty,
} from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIpAnalysisDataV2 } from '../../hooks/ip-analysis/useIpAnalysisDataV2';
import { useIpAnalysisChartsV2 } from '../../hooks/ip-analysis/useIpAnalysisChartsV2';
import { useIpBanData } from '../../hooks/ip-analysis/useIpBanData';
import { renderNumber, timestamp2string } from '../../helpers';
import OverviewTab from './OverviewTab';
import LoginAnalysisTab from './LoginAnalysisTab';
import ApiAnalysisTab from './ApiAnalysisTab';
import CrossAnalysisTab from './CrossAnalysisTab';
import IpBanTab from './IpBanTab';

const IpAnalysis = () => {
  const { t } = useTranslation();
  const {
    activeTab,
    setActiveTab,
    timeRange,
    setTimeRange,
    refreshInterval,
    updateRefreshInterval,
    loading,
    countdown,
    loadCurrentTab,
    loadIpModels,
    disableUsersBySharedIp,
    overviewData,
    loginGeoData,
    loginTimeData,
    loginTypeData,
    multiAccountData,
    apiTopIpsData,
    apiGeoData,
    apiTimeData,
    highFreqData,
    mismatchData,
    riskData,
    newIpsData,
    userIpSummaryData,
  } = useIpAnalysisDataV2();

  const chartSpecs = useIpAnalysisChartsV2(
    { loginGeoData, loginTimeData, loginTypeData },
    t,
  );

  const { bans, loading: banLoading, banIp, unbanIp } = useIpBanData();

  const [disableUsersModalOpen, setDisableUsersModalOpen] = useState(false);
  const [disableUsersLoading, setDisableUsersLoading] = useState(false);
  const [disableUsersIp, setDisableUsersIp] = useState('');
  const [disableUsersPreview, setDisableUsersPreview] = useState(null);
  const [disableUsersAlsoBanIp, setDisableUsersAlsoBanIp] = useState(false);
  const [disableUsersReason, setDisableUsersReason] = useState('');

  const handleDateChange = (dates) => {
    if (dates && dates.length === 2) {
      setTimeRange({
        start: Math.floor(dates[0].getTime() / 1000),
        end: Math.floor(dates[1].getTime() / 1000),
      });
    }
  };

  const handleDisableUsersByIp = async (ip) => {
    if (!ip || !disableUsersBySharedIp) return;

    setDisableUsersIp(ip);
    setDisableUsersAlsoBanIp(false);
    setDisableUsersReason('');
    setDisableUsersPreview(null);

    setDisableUsersModalOpen(true);
    setDisableUsersLoading(true);

    const res = await disableUsersBySharedIp({
      ip,
      start: timeRange.start,
      end: timeRange.end,
      min_users: 2,
      dry_run: true,
      also_ban_ip: false,
      reason: '',
    });

    setDisableUsersPreview(res || null);
    setDisableUsersLoading(false);
  };

  const handleConfirmDisableUsers = async () => {
    if (!disableUsersIp || !disableUsersBySharedIp) return;

    setDisableUsersLoading(true);
    const res = await disableUsersBySharedIp({
      ip: disableUsersIp,
      start: timeRange.start,
      end: timeRange.end,
      min_users: 2,
      dry_run: false,
      also_ban_ip: !!disableUsersAlsoBanIp,
      reason: disableUsersReason || '',
    });
    setDisableUsersLoading(false);

    if (res) {
      setDisableUsersModalOpen(false);
      loadCurrentTab();
    }
  };

  const progressPercent =
    refreshInterval > 0
      ? ((refreshInterval - countdown) / refreshInterval) * 100
      : 0;

  const previewTargets = disableUsersPreview?.targets || [];

  const previewColumns = useMemo(
    () => [
      {
        title: 'User ID',
        dataIndex: 'user_id',
        key: 'user_id',
        width: 120,
        render: (v) => (v === 0 ? '-' : v),
      },
      {
        title: t('用户名'),
        dataIndex: 'username',
        key: 'username',
        width: 160,
        render: (v) => v || '-',
      },
      {
        title: t('状态'),
        dataIndex: 'skip_reason',
        key: 'skip_reason',
        render: (v) =>
          v ? (
            <Tag color='grey' size='small'>
              {v}
            </Tag>
          ) : (
            <Tag color='red' size='small'>
              待封禁
            </Tag>
          ),
      },
    ],
    [t],
  );

  return (
    <div className='mt-[60px] px-4 pb-8'>
      {/* Control Bar */}
      <ControlBar
        t={t}
        timeRange={timeRange}
        refreshInterval={refreshInterval}
        loading={loading}
        countdown={countdown}
        progressPercent={progressPercent}
        onDateChange={handleDateChange}
        onRefreshIntervalChange={updateRefreshInterval}
        onRefresh={loadCurrentTab}
      />

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type='line'
        size='large'
        style={{ marginTop: 8 }}
      >
        <TabPane tab={t('概览')} itemKey='overview'>
          <OverviewTab
            data={overviewData}
            loading={loading}
            onNavigate={setActiveTab}
          />
        </TabPane>

        <TabPane tab={t('登录分析')} itemKey='login'>
          <LoginAnalysisTab
            loginGeoData={loginGeoData}
            loginTimeData={loginTimeData}
            loginTypeData={loginTypeData}
            multiAccountData={multiAccountData}
            loading={loading}
            chartSpecs={chartSpecs}
            onBanIp={banIp}
            onDisableUsersByIp={handleDisableUsersByIp}
          />
        </TabPane>

        <TabPane tab={t('API调用分析')} itemKey='api'>
          <ApiAnalysisTab
            apiTopIpsData={apiTopIpsData}
            apiGeoData={apiGeoData}
            apiTimeData={apiTimeData}
            highFreqData={highFreqData}
            loading={loading}
            onBanIp={banIp}
            loadIpModels={loadIpModels}
          />
        </TabPane>

        <TabPane tab={t('交叉分析')} itemKey='cross'>
          <CrossAnalysisTab
            mismatchData={mismatchData}
            riskData={riskData}
            newIpsData={newIpsData}
            userIpSummaryData={userIpSummaryData}
            loading={loading}
            onBanIp={banIp}
          />
        </TabPane>

        <TabPane tab={t('IP封禁')} itemKey='ban'>
          <IpBanTab
            bans={bans}
            loading={banLoading}
            banIp={banIp}
            unbanIp={unbanIp}
          />
        </TabPane>
      </Tabs>

      <Modal
        title={`禁用关联账号 - ${disableUsersIp || ''}`}
        visible={disableUsersModalOpen}
        onCancel={() => {
          if (!disableUsersLoading) setDisableUsersModalOpen(false);
        }}
        onOk={handleConfirmDisableUsers}
        okText='确认执行'
        okButtonProps={{
          type: 'danger',
          disabled: !disableUsersPreview || disableUsersLoading,
          loading: disableUsersLoading,
        }}
        cancelButtonProps={{ disabled: disableUsersLoading }}
        width={820}
      >
        <div className='space-y-4'>
          <div className='rounded-xl p-3 bg-[rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.08)]'>
            <div className='text-sm font-medium mb-2'>预览信息</div>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-3 text-sm'>
              <div className='flex items-center justify-between'>
                <span className='text-gray-500'>独立用户数</span>
                <span>
                  {renderNumber(disableUsersPreview?.distinct_user_count || 0)}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-gray-500'>目标数</span>
                <span>{renderNumber(previewTargets.length)}</span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-gray-500'>可执行</span>
                <span>
                  {renderNumber(
                    disableUsersPreview?.summary?.will_disable_count || 0,
                  )}
                </span>
              </div>
            </div>
            <div className='mt-2 text-xs text-gray-500'>
              时间范围：{timestamp2string(timeRange.start)} ~{' '}
              {timestamp2string(timeRange.end)}
            </div>
          </div>

          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <Switch
                checked={disableUsersAlsoBanIp}
                onChange={setDisableUsersAlsoBanIp}
                disabled={disableUsersLoading}
              />
              <span className='text-sm'>同时封禁该IP</span>
            </div>
            <Input
              value={disableUsersReason}
              onChange={setDisableUsersReason}
              disabled={disableUsersLoading}
              placeholder='封禁原因（可选）'
              showClear
            />
          </div>

          <Table
            columns={previewColumns}
            dataSource={previewTargets}
            pagination={{ pageSize: 10 }}
            size='small'
            rowKey={(r) => `${r.user_id}-${r.username}`}
            loading={disableUsersLoading}
            empty={<Empty description={t('暂无数据')} />}
          />
        </div>
      </Modal>
    </div>
  );
};

export default IpAnalysis;

/* ========== ControlBar ========== */

const ControlBar = ({
  t,
  timeRange,
  refreshInterval,
  loading,
  countdown,
  progressPercent,
  onDateChange,
  onRefreshIntervalChange,
  onRefresh,
}) => (
  <Card className='!rounded-2xl mb-4' bodyStyle={{ padding: '12px 20px' }}>
    <div className='flex flex-wrap items-center gap-4'>
      <DatePicker
        type='dateTimeRange'
        density='compact'
        value={[new Date(timeRange.start * 1000), new Date(timeRange.end * 1000)]}
        onChange={onDateChange}
        style={{ width: 380 }}
      />
      <div className='flex items-center gap-2'>
        <span className='text-sm text-gray-500 whitespace-nowrap'>
          {t('刷新间隔')}
        </span>
        <InputNumber
          size='small'
          min={10}
          max={3600}
          value={refreshInterval}
          onChange={onRefreshIntervalChange}
          suffix={t('秒')}
          style={{ width: 120 }}
        />
      </div>
      <Button
        icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
        size='small'
        onClick={onRefresh}
        loading={loading}
      >
        {t('刷新')}
      </Button>
      <div className='flex items-center gap-2 ml-auto'>
        <span className='text-xs text-gray-400'>{countdown}s</span>
        <Progress
          percent={progressPercent}
          size='small'
          style={{ width: 80 }}
          showInfo={false}
          stroke='var(--semi-color-primary)'
        />
      </div>
    </div>
  </Card>
);
