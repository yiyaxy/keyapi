import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Table, Tag, Empty, Spin, Tabs, TabPane } from '@douyinfe/semi-ui';
import { API, showError, timestamp2string } from '../../../../helpers';
import IpDetailModal from '../../usage-logs/IpDetailModal';

const UserIpHistoryModal = ({ visible, onCancel, user, t }) => {
  const [activeTab, setActiveTab] = useState('login');

  // Login records state
  const [loginRecords, setLoginRecords] = useState([]);
  const [loginTotal, setLoginTotal] = useState(0);
  const [loginPage, setLoginPage] = useState(1);
  const [loginLoading, setLoginLoading] = useState(false);

  // API usage records state
  const [apiRecords, setApiRecords] = useState([]);
  const [apiTotal, setApiTotal] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const [apiLoading, setApiLoading] = useState(false);

  const pageSize = 10;

  // IP detail sub-modal state
  const [showIpDetail, setShowIpDetail] = useState(false);
  const [selectedIp, setSelectedIp] = useState(null);

  const fetchLoginRecords = useCallback(async (p) => {
    if (!user?.id) return;
    setLoginLoading(true);
    try {
      const res = await API.get(
        `/api/user/${user.id}/ips?p=${p}&page_size=${pageSize}`,
      );
      if (res.data.success) {
        setLoginRecords(res.data.data.items || []);
        setLoginTotal(res.data.data.total || 0);
        setLoginPage(res.data.data.page || p);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoginLoading(false);
    }
  }, [user]);

  const fetchApiRecords = useCallback(async (p) => {
    if (!user?.id) return;
    setApiLoading(true);
    try {
      const res = await API.get(
        `/api/user/${user.id}/api-ips?p=${p}&page_size=${pageSize}`,
      );
      if (res.data.success) {
        setApiRecords(res.data.data.items || []);
        setApiTotal(res.data.data.total || 0);
        setApiPage(res.data.data.page || p);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setApiLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (visible && user?.id) {
      setLoginPage(1);
      setApiPage(1);
      fetchLoginRecords(1);
      fetchApiRecords(1);
    }
  }, [visible, user?.id]);

  const loginColumns = [
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 160,
      render: (text) => (
        <Tag
          color='orange'
          shape='circle'
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setSelectedIp(text);
            setShowIpDetail(true);
          }}
        >
          {text}
        </Tag>
      ),
    },
    {
      title: t('IP 地理位置'),
      dataIndex: 'ip_location',
      width: 200,
      render: (text) => {
        if (!text) return '-';
        try {
          const info = JSON.parse(text);
          return [info.country, info.region, info.city]
            .filter(Boolean)
            .join(' / ');
        } catch {
          return '-';
        }
      },
    },
    {
      title: t('登录类型'),
      dataIndex: 'login_type',
      width: 100,
      render: (text) => <Tag size='small'>{text || '-'}</Tag>,
    },
    {
      title: t('用户代理'),
      dataIndex: 'user_agent',
      ellipsis: true,
      render: (text) => text || '-',
    },
    {
      title: t('时间'),
      dataIndex: 'created_at',
      width: 180,
      render: (val) => (val ? timestamp2string(val) : '-'),
    },
  ];

  const apiColumns = [
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 160,
      render: (text) => (
        <Tag
          color='blue'
          shape='circle'
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setSelectedIp(text);
            setShowIpDetail(true);
          }}
        >
          {text}
        </Tag>
      ),
    },
    {
      title: t('调用次数'),
      dataIndex: 'count',
      width: 100,
      render: (val) => val || 0,
    },
    {
      title: t('最近使用模型'),
      dataIndex: 'model_name',
      width: 200,
      render: (text) => text || '-',
    },
    {
      title: t('最后使用时间'),
      dataIndex: 'last_used',
      width: 180,
      render: (val) => (val ? timestamp2string(val) : '-'),
    },
  ];

  return (
    <>
      <Modal
        title={`${t('IP记录')} - ${user?.username || ''}`}
        visible={visible}
        onCancel={onCancel}
        footer={null}
        width={850}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab={t('登录记录')} itemKey='login'>
            {loginLoading && loginRecords.length === 0 ? (
              <div className='flex justify-center py-8'>
                <Spin size='large' />
              </div>
            ) : loginRecords.length > 0 ? (
              <Table
                columns={loginColumns}
                dataSource={loginRecords}
                rowKey='id'
                size='small'
                pagination={{
                  currentPage: loginPage,
                  pageSize: pageSize,
                  total: loginTotal,
                  onPageChange: (p) => fetchLoginRecords(p),
                }}
                loading={loginLoading}
              />
            ) : (
              <Empty description={t('暂无登录记录')} />
            )}
          </TabPane>
          <TabPane tab={t('使用记录')} itemKey='api'>
            {apiLoading && apiRecords.length === 0 ? (
              <div className='flex justify-center py-8'>
                <Spin size='large' />
              </div>
            ) : apiRecords.length > 0 ? (
              <Table
                columns={apiColumns}
                dataSource={apiRecords}
                rowKey='ip'
                size='small'
                pagination={{
                  currentPage: apiPage,
                  pageSize: pageSize,
                  total: apiTotal,
                  onPageChange: (p) => fetchApiRecords(p),
                }}
                loading={apiLoading}
              />
            ) : (
              <Empty description={t('暂无使用记录')} />
            )}
          </TabPane>
        </Tabs>
      </Modal>

      <IpDetailModal
        visible={showIpDetail}
        ip={selectedIp}
        onClose={() => setShowIpDetail(false)}
      />
    </>
  );
};

export default UserIpHistoryModal;
