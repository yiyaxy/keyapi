import React, { useState, useEffect } from 'react';
import { Modal, Table, Spin, Empty } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { renderNumber, renderQuota } from '../../../helpers';

const CHART_CONFIG = { mode: 'desktop-browser' };

const IpModelDetailModal = ({ visible, ip, onClose, loadIpModels }) => {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && ip && loadIpModels) {
      setLoading(true);
      loadIpModels(ip).then((res) => {
        setData(res || []);
        setLoading(false);
      });
    }
  }, [visible, ip, loadIpModels]);

  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      key: 'model_name',
    },
    {
      title: t('调用次数'),
      dataIndex: 'call_count',
      key: 'call_count',
      render: (v) => renderNumber(v),
    },
    {
      title: t('消耗额度'),
      dataIndex: 'quota',
      key: 'quota',
      render: (v) => renderQuota(v, 6),
    },
    {
      title: 'Tokens',
      dataIndex: 'tokens',
      key: 'tokens',
      render: (v) => renderNumber(v),
    },
  ];

  const pieSpec =
    data.length > 0
      ? {
          type: 'pie',
          data: [
            {
              id: 'modelPie',
              values: data.map((d) => ({
                type: d.model_name,
                value: d.call_count,
              })),
            },
          ],
          outerRadius: 0.8,
          innerRadius: 0.5,
          valueField: 'value',
          categoryField: 'type',
          title: {
            visible: true,
            text: t('模型调用分布'),
          },
          legends: { visible: true, orient: 'bottom' },
          label: { visible: false },
        }
      : null;

  return (
    <Modal
      title={`${t('IP模型使用详情')} - ${ip}`}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      {loading ? (
        <div className='flex justify-center py-8'>
          <Spin />
        </div>
      ) : data.length === 0 ? (
        <Empty description={t('暂无数据')} />
      ) : (
        <>
          {pieSpec && (
            <div className='h-64 mb-4'>
              <VChart spec={pieSpec} option={CHART_CONFIG} />
            </div>
          )}
          <Table
            columns={columns}
            dataSource={data}
            pagination={false}
            size='small'
            rowKey='model_name'
          />
        </>
      )}
    </Modal>
  );
};

export default IpModelDetailModal;
