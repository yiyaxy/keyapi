import React, { useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Input,
  Button,
  DatePicker,
  Empty,
  Popconfirm,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { timestamp2string } from '../../helpers';

const IpBanTab = ({ bans, loading, banIp, unbanIp }) => {
  const { t } = useTranslation();
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newExpire, setNewExpire] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!newIp.trim()) return;
    setSubmitting(true);
    const expireAt = newExpire
      ? Math.floor(new Date(newExpire).getTime() / 1000)
      : 0;
    const ok = await banIp(newIp.trim(), newReason, expireAt);
    if (ok) {
      setNewIp('');
      setNewReason('');
      setNewExpire(null);
    }
    setSubmitting(false);
  };

  const columns = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 180 },
    {
      title: t('封禁原因'),
      dataIndex: 'reason',
      key: 'reason',
      render: (v) => v || '-',
    },
    {
      title: t('过期时间'),
      dataIndex: 'expire_at',
      key: 'expire_at',
      width: 180,
      render: (v) =>
        v > 0 ? (
          timestamp2string(v)
        ) : (
          <Tag color='red' size='small'>
            {t('永久封禁')}
          </Tag>
        ),
    },
    {
      title: t('创建时间'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v) => (v ? timestamp2string(v) : '-'),
    },
    {
      title: t('操作'),
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title={t('确认解封')}
          content={`${t('确认解封')} ${record.ip}?`}
          onConfirm={() => unbanIp(record.ip)}
        >
          <Button size='small' type='danger' theme='borderless'>
            {t('解封IP')}
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      className='!rounded-2xl'
      title={t('IP封禁列表')}
      headerExtraContent={
        <span className='text-sm text-gray-400'>
          {(bans || []).length} {t('条记录')}
        </span>
      }
    >
      {/* Manual Ban Form */}
      <div className='flex flex-wrap items-center gap-2 mb-4'>
        <Input
          size='small'
          placeholder='IP / CIDR'
          value={newIp}
          onChange={setNewIp}
          style={{ width: 180 }}
        />
        <Input
          size='small'
          placeholder={t('封禁原因')}
          value={newReason}
          onChange={setNewReason}
          style={{ width: 180 }}
        />
        <DatePicker
          type='dateTime'
          size='small'
          placeholder={t('过期时间')}
          value={newExpire}
          onChange={setNewExpire}
          style={{ width: 200 }}
        />
        <Button
          size='small'
          type='danger'
          loading={submitting}
          onClick={handleAdd}
        >
          {t('手动封禁')}
        </Button>
        <span className='text-xs text-gray-400'>
          {t('过期时间')} — {t('永久封禁')}
        </span>
      </div>

      <Table
        columns={columns}
        dataSource={bans || []}
        pagination={false}
        size='small'
        rowKey='id'
        loading={loading}
        empty={<Empty description={t('暂无数据')} />}
      />
    </Card>
  );
};

export default IpBanTab;
