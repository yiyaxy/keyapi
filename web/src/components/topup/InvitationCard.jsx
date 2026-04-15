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

import React from 'react';
import {
  Typography,
  Card,
  Button,
  Input,
  Badge,
  Space,
} from '@douyinfe/semi-ui';
import { Copy, Users, BarChart2, TrendingUp, Gift, Zap } from 'lucide-react';

const { Text, Title } = Typography;

const InvitationCard = ({
  t,
  userState,
  renderQuota,
  setOpenTransfer,
  affLink,
  handleAffLinkClick,
  topUpRebateCount = 0,
  topUpRebatePercent = 0,
}) => {
  const availableQuota = userState?.user?.aff_quota || 0;
  const historyQuota = userState?.user?.aff_history_quota || 0;
  const inviteCount = userState?.user?.aff_count || 0;

  const statItems = [
    {
      key: 'available',
      icon: <TrendingUp size={16} className='text-emerald-600' />,
      label: t('待使用收益'),
      value: renderQuota(availableQuota),
      valueClassName: 'text-emerald-700',
      cardClassName: 'border-emerald-100 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-900/40',
    },
    {
      key: 'history',
      icon: <BarChart2 size={16} className='text-slate-700' />,
      label: t('总收益'),
      value: renderQuota(historyQuota),
      valueClassName: 'text-slate-900 dark:text-slate-100',
      cardClassName: 'border-slate-200 bg-slate-50/80 dark:bg-slate-900/40 dark:border-slate-700',
    },
    {
      key: 'count',
      icon: <Users size={16} className='text-amber-600' />,
      label: t('邀请人数'),
      value: inviteCount,
      valueClassName: 'text-amber-700',
      cardClassName: 'border-amber-100 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-900/40',
    },
  ];

  return (
    <Card className='topup-card-surface !rounded-3xl'>
      <Space vertical spacing={16} style={{ width: '100%' }}>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
          <div className='flex items-start gap-3'>
            <div className='flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200 dark:border-cyan-900/40 bg-gradient-to-br from-cyan-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 shadow-sm'>
              <Gift size={18} className='text-cyan-700' />
            </div>
            <div>
              <Title heading={5} className='!mb-1 !text-slate-900 dark:!text-slate-100'>
                {t('邀请奖励')}
              </Title>
              <Text type='tertiary' className='text-sm'>
                {t('邀请好友获得额外奖励')}
              </Text>
            </div>
          </div>

          <Button
            type='primary'
            theme='solid'
            size='default'
            disabled={!availableQuota || availableQuota <= 0}
            onClick={() => setOpenTransfer(true)}
            className='!h-10 !rounded-xl !border-0 !bg-cyan-700 hover:!bg-cyan-600'
            icon={<Zap size={14} />}
          >
            {t('划转到余额')}
          </Button>
        </div>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
          {statItems.map((item) => (
            <div
              key={item.key}
              className={`rounded-2xl border px-4 py-4 ${item.cardClassName}`}
            >
              <div className='mb-3 flex items-center gap-2'>
                <div className='flex h-8 w-8 items-center justify-center rounded-xl bg-white/90 dark:bg-slate-900/60 shadow-sm'>
                  {item.icon}
                </div>
                <Text type='tertiary' className='text-xs font-medium tracking-[0.08em]'>
                  {item.label}
                </Text>
              </div>
              <div className={`text-xl font-semibold sm:text-2xl ${item.valueClassName}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className='rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-cyan-50/35 dark:from-slate-900 dark:to-slate-900/50 p-4 sm:p-5'>
          <div className='mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <Text className='text-sm font-medium text-slate-900 dark:text-slate-100'>
                {t('邀请链接')}
              </Text>
              <div className='mt-1'>
                <Text type='tertiary' className='text-xs'>
                  {t('邀请好友注册并充值，您可获得邀请奖励和充值返利')}
                </Text>
              </div>
            </div>
            <Button
              type='primary'
              theme='solid'
              onClick={handleAffLinkClick}
              icon={<Copy size={14} />}
              className='!h-10 !rounded-xl !border-0 !bg-white dark:!bg-slate-900 !text-cyan-700 dark:!text-cyan-300 shadow-sm hover:!bg-cyan-50 dark:hover:!bg-slate-800'
            >
              {t('复制')}
            </Button>
          </div>

          <Input
            value={affLink}
            readOnly
            className='!rounded-xl'
            size='large'
          />
        </div>

        <div className='rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-5'>
          <div className='mb-3 flex items-center justify-between'>
            <Text className='text-sm font-medium text-slate-900 dark:text-slate-100'>
              {t('奖励说明')}
            </Text>
            <Badge count={inviteCount} type='warning' />
          </div>

          <div className='space-y-2.5'>
            <div className='flex items-start gap-2'>
              <Badge dot type='success' />
              <Text type='tertiary' className='text-sm'>
                {t('邀请好友注册并充值，您可获得邀请奖励和充值返利')}
              </Text>
            </div>

            <div className='flex items-start gap-2'>
              <Badge dot type='success' />
              <Text type='tertiary' className='text-sm'>
                {t('通过划转功能可将邀请奖励转入您的账户余额')}
              </Text>
            </div>

            <div className='flex items-start gap-2'>
              <Badge dot type='success' />
              <Text type='tertiary' className='text-sm'>
                {t('邀请的好友越多，可获得的邀请奖励和充值返利越多')}
              </Text>
            </div>

            {topUpRebateCount !== 0 && topUpRebatePercent > 0 && (
              <div className='rounded-xl border border-cyan-100 dark:border-cyan-900/40 bg-cyan-50/70 dark:bg-cyan-950/25 px-3 py-2'>
                <div className='flex items-start gap-2'>
                  <Badge dot type='warning' />
                  <Text type='tertiary' className='text-sm'>
                    {topUpRebateCount === -1
                      ? t('好友每次充值，您都可获得其充值金额{{percent}}%的充值返利', { percent: topUpRebatePercent })
                      : t('好友前{{count}}次充值，您都可获得其充值金额{{percent}}%的充值返利', { count: topUpRebateCount, percent: topUpRebatePercent })}
                  </Text>
                </div>
              </div>
            )}
          </div>
        </div>
      </Space>
    </Card>
  );
};

export default InvitationCard;
