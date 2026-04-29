import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type ButtonProps } from '@lobehub/ui';
import { Button, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { GroupBotSquareIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BotIcon,
  ImageIcon,
  MessageSquareTextIcon,
  PenLineIcon,
  VideoIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { type StarterMode } from '@/store/home';
import { useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    border-color: ${cssVar.colorFillSecondary} !important;
    background: ${cssVar.colorBgElevated} !important;
  `,
  activeCard: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorPrimaryBg};
  `,
  button: css`
    height: 40px;
    border-color: ${cssVar.colorFillSecondary};
    background: transparent;
    box-shadow: none !important;

    &:hover {
      border-color: ${cssVar.colorFillSecondary} !important;
      background: ${cssVar.colorBgElevated} !important;
    }
  `,
  card: css`
    cursor: pointer;
    min-height: 92px;
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG}px;
    background: ${cssVar.colorBgContainer};
    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      transform 0.18s ease;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorFillQuaternary};
      transform: translateY(-1px);
    }
  `,
  cardGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;

    @media (max-width: 680px) {
      grid-template-columns: 1fr;
    }
  `,
  iconBox: css`
    width: 34px;
    height: 34px;
    border-radius: ${cssVar.borderRadius}px;
    background: ${cssVar.colorFillQuaternary};
  `,
  secondary: css`
    flex-wrap: wrap;
    justify-content: center;
  `,
}));

type StarterTitleKey =
  | 'starter.createAgent'
  | 'starter.createGroup'
  | 'starter.write'
  | 'starter.deepResearch';

interface StarterItem {
  disabled?: boolean;
  icon?: ButtonProps['icon'];
  key: StarterMode;
  titleKey: StarterTitleKey;
}

interface PrimaryItem {
  description: string;
  icon: ButtonProps['icon'];
  key: 'chat' | 'image' | 'video';
  title: string;
}

const StarterList = memo(() => {
  const { t } = useTranslation('home');

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.agentBuilder);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.groupAgentBuilder);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);

  const navigate = useStableNavigate();
  const [inputActiveMode, setInputActiveMode] = useHomeStore((s) => [
    s.inputActiveMode,
    s.setInputActiveMode,
  ]);

  const primaryItems: PrimaryItem[] = useMemo(
    () => [
      {
        description: '问问题、写文案、分析资料',
        icon: MessageSquareTextIcon,
        key: 'chat',
        title: 'AI 对话',
      },
      {
        description: '用文字生成图片，选择图片模型',
        icon: ImageIcon,
        key: 'image',
        title: '图片生成',
      },
      {
        description: '用文字或参考图生成视频',
        icon: VideoIcon,
        key: 'video',
        title: '视频生成',
      },
    ],
    [],
  );

  const items: StarterItem[] = useMemo(
    () => [
      {
        icon: BotIcon,
        key: 'agent',
        titleKey: 'starter.createAgent',
      },
      {
        icon: GroupBotSquareIcon,
        key: 'group',
        titleKey: 'starter.createGroup',
      },
      {
        icon: PenLineIcon,
        key: 'write',
        titleKey: 'starter.write',
      },
      // {
      //   disabled: true,
      //   icon: MicroscopeIcon,
      //   key: 'research',
      //   titleKey: 'starter.deepResearch',
      // },
    ],
    [],
  );

  const handlePrimaryClick = useCallback(
    (key: PrimaryItem['key']) => {
      if (key === 'chat') {
        setInputActiveMode(null);
        return;
      }

      navigate(key === 'image' ? '/image' : '/video');
    },
    [navigate, setInputActiveMode],
  );

  const handleClick = useCallback(
    (key: StarterMode) => {
      // Toggle mode: if clicking the active mode, clear it; otherwise set it
      if (inputActiveMode === key) {
        setInputActiveMode(null);
      } else {
        setInputActiveMode(key);
      }
    },
    [inputActiveMode, setInputActiveMode],
  );

  return (
    <Flexbox gap={12}>
      <div className={styles.cardGrid}>
        {primaryItems.map((item) => {
          const isActive = item.key === 'chat' && !inputActiveMode;

          return (
            <Flexbox
              horizontal
              align="center"
              className={cx(styles.card, isActive && styles.activeCard)}
              gap={12}
              key={item.key}
              onClick={() => handlePrimaryClick(item.key)}
            >
              <Flexbox align="center" className={styles.iconBox} justify="center">
                <Icon
                  icon={item.icon}
                  size={18}
                  style={{ color: isActive ? cssVar.colorPrimary : cssVar.colorTextSecondary }}
                />
              </Flexbox>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={14} weight={600}>
                  {item.title}
                </Text>
                <Text ellipsis fontSize={12} type="secondary">
                  {item.description}
                </Text>
              </Flexbox>
            </Flexbox>
          );
        })}
      </div>

      <Flexbox horizontal className={styles.secondary} gap={8}>
        {items.map((item) => {
          const button = (
            <Button
              className={cx(styles.button, inputActiveMode === item.key && styles.active)}
              disabled={item.disabled}
              icon={item.icon}
              key={item.key}
              shape={'round'}
              variant={'outlined'}
              iconProps={{
                color: inputActiveMode === item.key ? cssVar.colorText : cssVar.colorTextSecondary,
                size: 18,
              }}
              onClick={() => handleClick(item.key)}
            >
              {t(item.titleKey)}
            </Button>
          );

          if (item.disabled) {
            return (
              <Tooltip key={item.key} title={t('starter.developing')}>
                {button}
              </Tooltip>
            );
          }

          return button;
        })}
      </Flexbox>
    </Flexbox>
  );
});

export default StarterList;
