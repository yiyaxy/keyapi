import React, { useState, useEffect } from 'react';
import {
  Modal,
  Descriptions,
  Table,
  Tag,
  Spin,
  Empty,
  Tabs,
  TabPane,
  Button,
  Input,
  DatePicker,
  Popconfirm,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, timestamp2string } from '../../../helpers';

const IpDetailModal = ({ visible, ip, onClose }) => {
  const { t } = useTranslation();
  const [geoInfo, setGeoInfo] = useState(null);
  const [loginUsers, setLoginUsers] = useState([]);
  const [apiUsers, setApiUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [banStatus, setBanStatus] = useState(null); // null = unknown, object = banned
  const [banReason, setBanReason] = useState('');
  const [banExpire, setBanExpire] = useState(null);
  const [banLoading, setBanLoading] = useState(false);

  useEffect(() => {
    if (visible && ip) {
      fetchData();
      checkBanStatus();
    }
    if (!visible) {
      setBanStatus(null);
      setBanReason('');
      setBanExpire(null);
    }
  }, [visible, ip]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [geoRes, usersRes] = await Promise.all([
        API.get(`/api/ip/lookup?ip=${encodeURIComponent(ip)}`),
        API.get(`/api/ip/users?ip=${encodeURIComponent(ip)}`),
      ]);
      if (geoRes.data.success) {
        setGeoInfo(geoRes.data.data);
      }
      if (usersRes.data.success) {
        setLoginUsers(usersRes.data.data.login_users || []);
        setApiUsers(usersRes.data.data.api_users || []);
      }
    } catch (e) {
      showError(e.message || 'Failed to fetch IP details');
    } finally {
      setLoading(false);
    }
  };

  const checkBanStatus = async () => {
    try {
      const res = await API.get('/api/ip/bans');
      if (res.data.success) {
        const found = (res.data.data || []).find((b) => b.ip === ip);
        setBanStatus(found || false);
      }
    } catch {
      // ignore
    }
  };

  const handleBan = async () => {
    setBanLoading(true);
    try {
      const expireAt = banExpire
        ? Math.floor(new Date(banExpire).getTime() / 1000)
        : 0;
      const res = await API.post('/api/ip/ban', {
        ip,
        reason: banReason,
        expire_at: expireAt,
      });
      if (res.data.success) {
        showSuccess(t('封禁成功'));
        checkBanStatus();
        setBanReason('');
        setBanExpire(null);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setBanLoading(false);
    }
  };

  const handleUnban = async () => {
    setBanLoading(true);
    try {
      const res = await API.post('/api/ip/unban', { ip });
      if (res.data.success) {
        showSuccess(t('解封成功'));
        setBanStatus(false);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setBanLoading(false);
    }
  };

  const userColumns = [
    { title: t('用户名'), dataIndex: 'username', key: 'username' },
    { title: t('登录次数'), dataIndex: 'count', key: 'count', width: 100 },
    {
      title: t('最后登录'),
      dataIndex: 'last_login',
      key: 'last_login',
      width: 180,
      render: (val) => (val ? timestamp2string(val) : '-'),
    },
  ];

  return (
    <Modal
      title={`${t('IP 详情')} - ${ip || ''}`}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={640}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
    >
      {loading ? (
        <div className='flex justify-center py-8'>
          <Spin size='large' />
        </div>
      ) : (
        <>
          {geoInfo && (
            <div className='mb-4'>
              <h4 className='text-sm font-semibold mb-2'>{t('IP 地理位置')}</h4>
              <Descriptions
                data={[
                  { key: t('国家'), value: geoInfo.country || '-' },
                  { key: t('地区'), value: geoInfo.region || '-' },
                  { key: t('城市'), value: geoInfo.city || '-' },
                  { key: t('ISP'), value: geoInfo.isp || '-' },
                  { key: t('时区'), value: geoInfo.timezone || '-' },
                ]}
                row
                size='small'
              />
            </div>
          )}

          {/* Ban/Unban Section */}
          <div className='mb-4 p-3 rounded-lg' style={{ background: 'var(--semi-color-fill-0)' }}>
            {banStatus && banStatus.id ? (
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Tag color='red' size='large'>{t('已封禁')}</Tag>
                  {banStatus.reason && (
                    <span className='text-sm text-gray-500'>
                      {t('封禁原因')}: {banStatus.reason}
                    </span>
                  )}
                  {banStatus.expire_at > 0 && (
                    <span className='text-sm text-gray-400'>
                      {t('过期时间')}: {timestamp2string(banStatus.expire_at)}
                    </span>
                  )}
                </div>
                <Popconfirm
                  title={t('确认解封')}
                  content={`${t('确认解封')} ${ip}?`}
                  onConfirm={handleUnban}
                >
                  <Button size='small' loading={banLoading}>
                    {t('解封IP')}
                  </Button>
                </Popconfirm>
              </div>
            ) : (
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-2'>
                  <Input
                    size='small'
                    placeholder={t('封禁原因')}
                    value={banReason}
                    onChange={setBanReason}
                    style={{ width: 200 }}
                  />
                  <DatePicker
                    type='dateTime'
                    size='small'
                    placeholder={t('过期时间')}
                    value={banExpire}
                    onChange={setBanExpire}
                    style={{ width: 200 }}
                  />
                  <Popconfirm
                    title={t('确认封禁')}
                    content={`${t('确认封禁')} ${ip}?`}
                    onConfirm={handleBan}
                  >
                    <Button
                      size='small'
                      type='danger'
                      loading={banLoading}
                    >
                      {t('封禁此IP')}
                    </Button>
                  </Popconfirm>
                </div>
                <span className='text-xs text-gray-400'>
                  {t('过期时间')} {t('永久封禁')}
                </span>
              </div>
            )}
          </div>

          <Tabs type='line' size='small'>
            <TabPane tab={`${t('登录用户')} (${loginUsers.length})`} itemKey='login'>
              {loginUsers.length > 0 ? (
                <Table
                  columns={userColumns}
                  dataSource={loginUsers}
                  pagination={false}
                  size='small'
                  rowKey='user_id'
                />
              ) : (
                <Empty description={t('暂无数据')} />
              )}
            </TabPane>
            <TabPane tab={`${t('API用户')} (${apiUsers.length})`} itemKey='api'>
              {apiUsers.length > 0 ? (
                <Table
                  columns={userColumns}
                  dataSource={apiUsers}
                  pagination={false}
                  size='small'
                  rowKey='user_id'
                />
              ) : (
                <Empty description={t('暂无数据')} />
              )}
            </TabPane>
          </Tabs>
        </>
      )}
    </Modal>
  );
};

export default IpDetailModal;
