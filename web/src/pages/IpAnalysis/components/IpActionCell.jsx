import React from 'react';
import { Button, Popconfirm } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

const IpActionCell = ({
  ip,
  isBanned,
  onBan,
  onViewUsers,
  onDisableUsers,
  banReason,
}) => {
  const { t } = useTranslation();

  return (
    <div className='flex gap-1 flex-wrap'>
      {!isBanned ? (
        <Popconfirm
          title={t('确认封禁')}
          content={`${t('确认封禁')} ${ip}?`}
          onConfirm={() => onBan(ip, banReason || '')}
        >
          <Button size='small' type='danger' theme='borderless'>
            {t('封禁')}
          </Button>
        </Popconfirm>
      ) : (
        <Button size='small' disabled theme='borderless'>
          {t('已封禁')}
        </Button>
      )}
      {onDisableUsers && (
        <Button
          size='small'
          type='danger'
          theme='borderless'
          disabled={!ip}
          onClick={() => onDisableUsers(ip)}
        >
          禁用关联账号
        </Button>
      )}
      {onViewUsers && (
        <Button
          size='small'
          theme='borderless'
          onClick={() => onViewUsers(ip)}
        >
          {t('查看用户')}
        </Button>
      )}
    </div>
  );
};

export default IpActionCell;
