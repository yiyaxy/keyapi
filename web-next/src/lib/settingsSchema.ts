export type FieldKind =
  | 'bool'
  | 'number'
  | 'text'
  | 'longText'
  | 'json'
  | 'secret'
  | 'kvMap' // {key: number | string}
  | 'stringList' // ["a", "b"]
  | 'select'; // fixed enum — set of value/label options

export type SelectOption = {
  value: string;
  label: { zh: string; en: string };
};

export type FieldDef = {
  key: string;
  kind: FieldKind;
  label: { zh: string; en: string };
  help?: { zh: string; en: string };
  placeholder?: string;
  /** for kvMap: key column label */
  kvKeyLabel?: { zh: string; en: string };
  /** for kvMap: value column label */
  kvValueLabel?: { zh: string; en: string };
  /** for kvMap: value type */
  kvValueType?: 'number' | 'string';
  /** for select: enum options */
  options?: SelectOption[];
};

export type Group = {
  id: string;
  title: { zh: string; en: string };
  fields: FieldDef[];
};

function f(
  key: string,
  kind: FieldKind,
  label: { zh: string; en: string },
  help?: { zh: string; en: string }
): FieldDef {
  return { key, kind, label, help };
}

function sel(
  key: string,
  label: { zh: string; en: string },
  options: SelectOption[],
  help?: { zh: string; en: string }
): FieldDef {
  return { key, kind: 'select', label, help, options };
}

function kv(
  key: string,
  label: { zh: string; en: string },
  opts: {
    keyLabel: { zh: string; en: string };
    valueLabel: { zh: string; en: string };
    valueType: 'number' | 'string';
    help?: { zh: string; en: string };
  }
): FieldDef {
  return {
    key,
    kind: 'kvMap',
    label,
    help: opts.help,
    kvKeyLabel: opts.keyLabel,
    kvValueLabel: opts.valueLabel,
    kvValueType: opts.valueType,
  };
}

export const SETTINGS_GROUPS: Group[] = [
  {
    id: 'general',
    title: { zh: '基础信息', en: 'General' },
    fields: [
      f('SystemName', 'text', { zh: '站点名称', en: 'Site name' }),
      f('Logo', 'text', { zh: 'Logo URL', en: 'Logo URL' }),
      f('Footer', 'longText', { zh: '页脚（HTML）', en: 'Footer (HTML)' }),
      f('Notice', 'longText', { zh: '公告（Markdown）', en: 'Notice (Markdown)' }),
      f('HomePageContent', 'longText', {
        zh: '首页正文（Markdown）',
        en: 'Home page content (Markdown)',
      }),
      f('About', 'longText', { zh: '关于页面', en: 'About page' }),
      f('ServerAddress', 'text', { zh: '服务端地址', en: 'Server address' }),
      f('TopUpLink', 'text', { zh: '充值跳转链接', en: 'Top-up link' }),
      f('ChatLink', 'text', { zh: '聊天跳转链接', en: 'Chat link' }),
      f('Chats', 'json', { zh: '聊天入口 JSON', en: 'Chat entries (JSON)' }),
    ],
  },
  {
    id: 'login',
    title: { zh: '登录与注册', en: 'Login & register' },
    fields: [
      f('PasswordLoginEnabled', 'bool', { zh: '启用密码登录', en: 'Password login' }),
      f('PasswordRegisterEnabled', 'bool', {
        zh: '启用密码注册',
        en: 'Password register',
      }),
      f('RegisterEnabled', 'bool', { zh: '允许注册', en: 'Registration open' }),
      f('EmailVerificationEnabled', 'bool', {
        zh: '注册需邮箱验证',
        en: 'Require email verification',
      }),
      f('EmailDomainRestrictionEnabled', 'bool', {
        zh: '限制注册邮箱域名',
        en: 'Restrict email domains',
      }),
      f('EmailDomainWhitelist', 'longText', {
        zh: '邮箱域名白名单（逗号分隔）',
        en: 'Email domain whitelist',
      }),
      f('EmailAliasRestrictionEnabled', 'bool', {
        zh: '禁止别名邮箱',
        en: 'Block email aliases',
      }),
      f('TurnstileCheckEnabled', 'bool', {
        zh: '启用 Turnstile',
        en: 'Enable Turnstile',
      }),
      f('TurnstileSiteKey', 'text', {
        zh: 'Turnstile site key',
        en: 'Turnstile site key',
      }),
    ],
  },
  {
    id: 'oauth',
    title: { zh: 'OAuth 集成', en: 'OAuth providers' },
    fields: [
      f('GitHubOAuthEnabled', 'bool', { zh: '启用 GitHub', en: 'Enable GitHub' }),
      f('GitHubClientId', 'text', { zh: 'GitHub client ID', en: 'GitHub client ID' }),
      f('WeChatAuthEnabled', 'bool', { zh: '启用微信', en: 'Enable WeChat' }),
      f('WeChatServerAddress', 'text', {
        zh: '微信服务器地址',
        en: 'WeChat server URL',
      }),
      f('WeChatAccountQRCodeImageURL', 'text', {
        zh: '公众号二维码 URL',
        en: 'WeChat QR image URL',
      }),
      sel(
        'WxMiniEnvVersion',
        { zh: '微信小程序版本', en: 'Mini-program version' },
        [
          { value: 'release', label: { zh: '正式版', en: 'Release' } },
          { value: 'trial', label: { zh: '体验版', en: 'Trial' } },
          { value: 'develop', label: { zh: '开发版', en: 'Develop' } },
        ],
        {
          zh: '扫码登录/绑定使用的小程序码环境。未发布时选体验版或开发版；选体验版时扫码者必须是微信后台的体验成员。',
          en: 'Which mini-program build the scan QR targets. Before publishing, pick Trial or Develop. Trial QRs only open for accounts added as trial members in mp.weixin.qq.com.',
        }
      ),
      f('LinuxDOOAuthEnabled', 'bool', {
        zh: '启用 LinuxDO',
        en: 'Enable LinuxDO',
      }),
      f('LinuxDOClientId', 'text', {
        zh: 'LinuxDO client ID',
        en: 'LinuxDO client ID',
      }),
      f('LinuxDOMinimumTrustLevel', 'number', {
        zh: 'LinuxDO 最低信任等级',
        en: 'LinuxDO minimum trust level',
      }),
      f('TelegramOAuthEnabled', 'bool', {
        zh: '启用 Telegram',
        en: 'Enable Telegram',
      }),
      f('TelegramBotName', 'text', {
        zh: 'Telegram bot name',
        en: 'Telegram bot name',
      }),
    ],
  },
  {
    id: 'smtp',
    title: { zh: 'SMTP 邮件', en: 'SMTP email' },
    fields: [
      f('SMTPServer', 'text', { zh: 'SMTP 服务器', en: 'SMTP host' }),
      f('SMTPPort', 'number', { zh: 'SMTP 端口', en: 'SMTP port' }),
      f('SMTPAccount', 'text', { zh: 'SMTP 账号', en: 'SMTP account' }),
      f('SMTPFrom', 'text', { zh: '发件人地址', en: 'SMTP from' }),
      f('SMTPSSLEnabled', 'bool', { zh: '启用 SSL', en: 'Use SSL' }),
    ],
  },
  {
    id: 'quota',
    title: { zh: '额度与计费', en: 'Quota & billing' },
    fields: [
      sel(
        'general_setting.quota_display_type',
        { zh: '额度展示类型', en: 'Quota display type' },
        [
          { value: 'USD', label: { zh: '美元 ($)', en: 'USD ($)' } },
          { value: 'CNY', label: { zh: '人民币 (¥)', en: 'CNY (¥)' } },
          { value: 'TOKENS', label: { zh: 'Tokens（原始）', en: 'TOKENS (raw)' } },
          { value: 'CUSTOM', label: { zh: '自定义货币', en: 'Custom currency' } },
        ],
        {
          zh: '切到 CNY 时记得把下面的"支付单价 (Price)"改为 1，否则会按汇率重复换算导致实付金额异常。',
          en: 'When switching to CNY, set Price below to 1 — otherwise payment amounts will be scaled by the exchange rate twice.',
        }
      ),
      f(
        'general_setting.custom_currency_symbol',
        'text',
        { zh: '自定义货币符号', en: 'Custom currency symbol' },
        {
          zh: '仅当展示类型为"自定义货币"时生效',
          en: 'Only used when display type is CUSTOM',
        }
      ),
      f(
        'general_setting.custom_currency_exchange_rate',
        'number',
        { zh: '自定义货币汇率 (1 USD =)', en: 'Custom currency rate (1 USD =)' },
        {
          zh: '1 美元等于多少自定义货币；仅 CUSTOM 模式下生效',
          en: 'How many units per 1 USD; only used when display type is CUSTOM',
        }
      ),
      f(
        'Price',
        'number',
        { zh: '支付单价 (1 USD = X CNY)', en: 'Payment unit price (1 USD = X CNY)' },
        {
          zh: '后端扣款时 amount × Price = 实付 CNY。展示类型 = CNY 时应设为 1；USD 时应设为当前汇率（默认 7.3）',
          en: 'Backend charges amount × Price in CNY. Set to 1 for CNY display mode; keep at the USD/CNY rate (default 7.3) for USD mode.',
        }
      ),
      f('QuotaPerUnit', 'number', {
        zh: '每单位美元对应额度',
        en: 'Quota per USD',
      }),
      f('USDExchangeRate', 'number', { zh: '美元汇率', en: 'USD exchange rate' }),
      f('QuotaForNewUser', 'number', {
        zh: '新用户赠送额度',
        en: 'New user quota',
      }),
      f('PreConsumedQuota', 'number', {
        zh: '请求预扣额度',
        en: 'Pre-consumed quota',
      }),
      f('QuotaForInviter', 'number', {
        zh: '邀请人奖励额度',
        en: 'Inviter reward',
      }),
      f('QuotaForInvitee', 'number', {
        zh: '被邀请人奖励额度',
        en: 'Invitee reward',
      }),
      f('TopUpRebateCount', 'number', {
        zh: '充值返利次数',
        en: 'Top-up rebate count',
      }),
      f('TopUpRebatePercent', 'number', {
        zh: '充值返利比例 (%)',
        en: 'Top-up rebate %',
      }),
      f('SubscriptionRebateCount', 'number', {
        zh: '订阅返利次数',
        en: 'Subscription rebate count',
      }),
      f('MinTopUp', 'number', { zh: '最小充值额', en: 'Min top-up' }),
      // DisplayInCurrencyEnabled intentionally omitted — it's a legacy bool
      // that only toggles between USD/TOKENS and, when saved, overwrites
      // general_setting.quota_display_type (see controller/.../option.go).
      // Admins should use the "额度展示类型" select above instead, which
      // covers all four modes (USD/CNY/TOKENS/CUSTOM).
      f('DisplayTokenStatEnabled', 'bool', {
        zh: '展示 token 统计',
        en: 'Show token stats',
      }),
    ],
  },
  {
    id: 'ratios',
    title: { zh: '分组与模型倍率', en: 'Groups & ratios' },
    fields: [
      kv(
        'GroupRatio',
        { zh: '用户分组倍率', en: 'Group ratio' },
        {
          keyLabel: { zh: '分组', en: 'Group' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
          help: {
            zh: '键为分组名，值为倍率。例如 vip = 0.5',
            en: 'Key = group name, value = ratio (e.g. vip = 0.5)',
          },
        }
      ),
      kv(
        'UserUsableGroups',
        { zh: '用户可用分组', en: 'User usable groups' },
        {
          keyLabel: { zh: '分组', en: 'Group' },
          valueLabel: { zh: '描述', en: 'Description' },
          valueType: 'string',
          help: {
            zh: '用户新建令牌时可选的分组',
            en: 'Groups users can pick when creating tokens',
          },
        }
      ),
      kv(
        'TopupGroupRatio',
        { zh: '充值分组倍率', en: 'Top-up group ratio' },
        {
          keyLabel: { zh: '分组', en: 'Group' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      {
        key: 'AutoGroups',
        kind: 'stringList',
        label: {
          zh: '自动分组优先级',
          en: 'Auto group priority',
        },
        help: {
          zh: '按顺序尝试，越前越优先',
          en: 'Tried in order, first has highest priority',
        },
      },
      f('DefaultUseAutoGroup', 'bool', {
        zh: '默认使用 auto 分组',
        en: 'Default to auto group',
      }),
      kv(
        'ModelPrice',
        { zh: '模型价格（每次固定 $）', en: 'Model price (fixed $ per call)' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '价格 ($)', en: 'Price ($)' },
          valueType: 'number',
          help: {
            zh: '设置后该模型按固定价格计费，不再按 token',
            en: 'When set, the model is priced per call instead of per token',
          },
        }
      ),
      kv(
        'ModelRatio',
        { zh: '模型倍率', en: 'Model ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'CompletionRatio',
        { zh: '补全倍率', en: 'Completion ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'CacheRatio',
        { zh: '缓存倍率', en: 'Cache ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'CreateCacheRatio',
        { zh: '创建缓存倍率', en: 'Create cache ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'ImageRatio',
        { zh: '图片倍率', en: 'Image ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'AudioRatio',
        { zh: '音频倍率', en: 'Audio ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      kv(
        'AudioCompletionRatio',
        { zh: '音频补全倍率', en: 'Audio completion ratio' },
        {
          keyLabel: { zh: '模型', en: 'Model' },
          valueLabel: { zh: '倍率', en: 'Ratio' },
          valueType: 'number',
        }
      ),
      f('GroupGroupRatio', 'json', {
        zh: '分组-分组特殊倍率',
        en: 'Group→group special ratio',
      }),
    ],
  },
  {
    id: 'monitor',
    title: { zh: '渠道监控与重试', en: 'Channel monitor & retry' },
    fields: [
      f('RetryTimes', 'number', { zh: '重试次数', en: 'Retry times' }),
      f('ChannelDisableThreshold', 'number', {
        zh: '渠道禁用阈值（秒）',
        en: 'Channel disable threshold (s)',
      }),
      f('QuotaRemindThreshold', 'number', {
        zh: '额度不足提醒阈值',
        en: 'Low-quota remind threshold',
      }),
      f('AutomaticDisableChannelEnabled', 'bool', {
        zh: '自动禁用失败渠道',
        en: 'Auto-disable failed channels',
      }),
      f('AutomaticEnableChannelEnabled', 'bool', {
        zh: '自动恢复渠道',
        en: 'Auto-enable channels',
      }),
      f('AutomaticDisableKeywords', 'longText', {
        zh: '触发禁用的关键词',
        en: 'Auto-disable keywords',
      }),
      f('AutomaticDisableStatusCodes', 'text', {
        zh: '触发禁用的状态码',
        en: 'Auto-disable status codes',
      }),
      f('AutomaticRetryStatusCodes', 'text', {
        zh: '自动重试状态码',
        en: 'Auto-retry status codes',
      }),
      f('ChannelMonitorVisibility', 'text', {
        zh: '渠道监控可见性',
        en: 'Channel monitor visibility',
      }),
    ],
  },
  {
    id: 'channel-stability',
    title: { zh: '渠道稳定性', en: 'Channel stability' },
    fields: [
      f(
        'ChannelStabilityStreamBoundaryEnabled',
        'bool',
        {
          zh: '启用流式重试边界',
          en: 'Stream retry boundary',
        },
        {
          zh: '开启后，流式响应一旦已经把首个 token 或内容块发给用户，后续上游报错就不会再静默切到其他渠道重放请求，避免同一次输出混入两个渠道的内容。首 token 前仍允许按原重试策略切换。建议生产环境开启。',
          en: 'When enabled, once a streaming response has sent the first token or content chunk to the user, later upstream errors will not silently replay the request on another channel. This prevents mixed output from two channels in one response. Retries before the first token still follow the normal retry policy. Recommended for production.',
        }
      ),
      f(
        'ChannelStabilityErrorClassificationEnabled',
        'bool',
        {
          zh: '启用错误分类',
          en: 'Error classification',
        },
        {
          zh: '开启后，系统会结合 HTTP 状态、供应商错误码和错误文本，把失败分成普通错误、短期抖动、按上游 Retry-After 调度的冷却、认证刷新类错误和永久故障。额度不足、Key 无效等永久错误仍走禁用或告警；429、5xx、连接超时等短期问题会进入重试或冷却，减少误禁用。',
          en: 'When enabled, failures are classified from HTTP status, provider error code, and error text into normal errors, transient issues, upstream Retry-After scheduled cooldowns, auth-refresh cases, and permanent failures. Permanent problems such as insufficient quota or invalid keys still trigger disable/alert behavior, while 429, 5xx, and timeout-like issues can retry or cool down instead of being misclassified as permanent.',
        }
      ),
      f(
        'ChannelStabilityCooldownEnabled',
        'bool',
        {
          zh: '启用冷却状态',
          en: 'Cooldown state',
        },
        {
          zh: '开启后，被错误分类判定为短期抖动或上游要求等待的渠道不会立刻禁用，而是写入 cooldown_until、cooldown_reason 和 cooldown_count。冷却期内该渠道临时退出选路，倒计时结束后自动恢复，并按 warm-up 权重逐步回流。上游 Retry-After 会被采用，但会被限制在安全时长范围内。',
          en: 'When enabled, channels classified as transiently failing or asked by the upstream to wait are not immediately disabled. The system writes cooldown_until, cooldown_reason, and cooldown_count, temporarily removes the channel from routing during the cooldown, then restores it automatically with warm-up weighting. Upstream Retry-After is honored but clamped to a safe duration range.',
        }
      ),
      f(
        'ChannelStabilityHealthScoreEnabled',
        'bool',
        {
          zh: '启用健康分选路',
          en: 'Health-score routing',
        },
        {
          zh: '预留开关。当前监控页已经能展示 normal、degraded、abnormal 和冷却状态，但健康分尚未接入实际选路权重；现在开启不会立刻改变请求分配。后续阶段会把近期成功率、错误率和延迟转换为健康分，让高错误率或高延迟渠道提前降权，恢复后再逐步回流。',
          en: 'Reserved switch. The monitor page already exposes normal, degraded, abnormal, and cooldown states, but health scores are not yet fed into live routing weights; enabling it now does not immediately change request distribution. A later phase will convert recent success rate, error rate, and latency into a health score so unhealthy channels are down-weighted before hard failure and gradually restored after recovery.',
        }
      ),
      f(
        'ChannelStabilityAffinityGovernanceEnabled',
        'bool',
        {
          zh: '启用亲和治理',
          en: 'Affinity governance',
        },
        {
          zh: '预留开关。现有 channel affinity 仍按原亲和规则和缓存配置运行；该开关用于后续治理增强，包括按模型或租户调整 TTL、统计亲和命中率和失效率，以及在 fallback、冷却或连续失败后衰减甚至清理亲和关系。当前开启不会改变现有亲和缓存行为。',
          en: 'Reserved switch. Existing channel affinity continues to follow its current rules and cache configuration. This switch is for future governance enhancements, including model/tenant-specific TTL, affinity hit/failure metrics, and decaying or evicting affinity after fallback, cooldown, or repeated failures. Enabling it now does not change current affinity-cache behavior.',
        }
      ),
    ],
  },
  {
    id: 'ratelimit',
    title: { zh: '速率限制', en: 'Rate limit' },
    fields: [
      f('ModelRequestRateLimitEnabled', 'bool', {
        zh: '启用模型请求限流',
        en: 'Enable model request rate limit',
      }),
      f('ModelRequestRateLimitCount', 'number', {
        zh: '请求次数上限',
        en: 'Request count cap',
      }),
      f('ModelRequestRateLimitSuccessCount', 'number', {
        zh: '成功请求上限',
        en: 'Success count cap',
      }),
      f('ModelRequestRateLimitDurationMinutes', 'number', {
        zh: '窗口时长（分钟）',
        en: 'Window (minutes)',
      }),
      f('ModelRequestRateLimitGroup', 'text', {
        zh: '作用分组',
        en: 'Applies to group',
      }),
    ],
  },
  {
    id: 'sensitive',
    title: { zh: '敏感词过滤', en: 'Sensitive words' },
    fields: [
      f('CheckSensitiveEnabled', 'bool', {
        zh: '启用敏感词检查',
        en: 'Enable sensitive check',
      }),
      f('CheckSensitiveOnPromptEnabled', 'bool', {
        zh: '仅检查 prompt',
        en: 'Check prompt only',
      }),
      f('StopOnSensitiveEnabled', 'bool', {
        zh: '命中后中断请求',
        en: 'Stop on sensitive hit',
      }),
      f('SensitiveWords', 'longText', { zh: '敏感词列表', en: 'Sensitive words' }),
    ],
  },
  {
    id: 'permissions',
    title: { zh: '文件与站点模式', en: 'Files & site modes' },
    fields: [
      f('FileDownloadPermission', 'text', {
        zh: '文件下载权限',
        en: 'File download permission',
      }),
      f('FileUploadPermission', 'text', {
        zh: '文件上传权限',
        en: 'File upload permission',
      }),
      f('ImageDownloadPermission', 'text', {
        zh: '图片下载权限',
        en: 'Image download permission',
      }),
      f('ImageUploadPermission', 'text', {
        zh: '图片上传权限',
        en: 'Image upload permission',
      }),
      f('DemoSiteEnabled', 'bool', { zh: '启用演示站模式', en: 'Demo site mode' }),
      f('SelfUseModeEnabled', 'bool', {
        zh: '启用自用模式',
        en: 'Self-use mode',
      }),
      f('ExposeRatioEnabled', 'bool', {
        zh: '暴露倍率给用户',
        en: 'Expose ratios to users',
      }),
      f('DefaultCollapseSidebar', 'bool', {
        zh: '默认收起侧边栏',
        en: 'Collapse sidebar by default',
      }),
    ],
  },
  {
    id: 'log',
    title: { zh: '日志与导出', en: 'Log & export' },
    fields: [
      f('LogConsumeEnabled', 'bool', { zh: '记录消耗日志', en: 'Log consumption' }),
      f('DataExportEnabled', 'bool', {
        zh: '启用数据导出',
        en: 'Enable data export',
      }),
      f('DataExportDefaultTime', 'text', {
        zh: '导出默认时间窗',
        en: 'Default export window',
      }),
      f('DataExportInterval', 'number', {
        zh: '导出间隔（分钟）',
        en: 'Export interval (min)',
      }),
    ],
  },
  {
    id: 'payment_epay',
    title: { zh: '支付 · 易支付', en: 'Payment · Epay' },
    fields: [
      f('EpayId', 'text', { zh: '易支付商户 ID', en: 'Epay merchant ID' }),
      f('PayAddress', 'text', { zh: '支付地址', en: 'Pay address' }),
      f('PayMethods', 'json', { zh: '支付方式 JSON', en: 'Pay methods (JSON)' }),
      f('CustomCallbackAddress', 'text', {
        zh: '自定义回调地址',
        en: 'Custom callback URL',
      }),
      f('PaymentReturnUrl', 'text', {
        zh: '支付完成跳转 URL',
        en: 'Payment return URL',
      }),
    ],
  },
  {
    id: 'payment_stripe',
    title: { zh: '支付 · Stripe', en: 'Payment · Stripe' },
    fields: [
      f('StripePriceId', 'text', { zh: 'Stripe price ID', en: 'Stripe price ID' }),
      f('StripeMinTopUp', 'number', {
        zh: 'Stripe 最小充值',
        en: 'Stripe min top-up',
      }),
      f('StripeUnitPrice', 'number', {
        zh: 'Stripe 单价',
        en: 'Stripe unit price',
      }),
      f('StripePromotionCodesEnabled', 'bool', {
        zh: '允许优惠码',
        en: 'Allow promotion codes',
      }),
    ],
  },
  {
    id: 'payment_creem',
    title: { zh: '支付 · Creem', en: 'Payment · Creem' },
    fields: [
      f('CreemProducts', 'json', { zh: '商品 JSON', en: 'Creem products (JSON)' }),
      f('CreemTestMode', 'bool', { zh: '测试模式', en: 'Test mode' }),
    ],
  },
  {
    id: 'invoice',
    title: { zh: '发票', en: 'Invoices' },
    fields: [
      f('InvoiceProvider', 'text', { zh: '发票服务商', en: 'Invoice provider' }),
      f('InvoiceAutoIssueEnabled', 'bool', {
        zh: '自动开票',
        en: 'Auto-issue invoices',
      }),
      f('MinInvoiceAmount', 'number', {
        zh: '最小开票金额',
        en: 'Min invoice amount',
      }),
      f('InvoiceSellerEnterpriseName', 'text', {
        zh: '销方企业名称',
        en: 'Seller enterprise name',
      }),
      f('InvoiceSellerTaxpayerNum', 'text', {
        zh: '销方税号',
        en: 'Seller tax ID',
      }),
      f('InvoiceDefaultAccount', 'text', {
        zh: '默认账户',
        en: 'Default account',
      }),
      f('InvoiceDefaultGoodsName', 'text', {
        zh: '默认商品名',
        en: 'Default goods name',
      }),
      f('InvoiceDefaultTaxRateValue', 'text', {
        zh: '默认税率',
        en: 'Default tax rate',
      }),
      f('InvoiceDefaultIssueKindCode', 'text', {
        zh: '默认开票类型',
        en: 'Default issue kind',
      }),
      f('InvoiceDefaultPaymentCode', 'text', {
        zh: '默认支付代码',
        en: 'Default payment code',
      }),
      f('InvoiceDefaultSubMchid', 'text', {
        zh: '默认子商户号',
        en: 'Default sub-merchant',
      }),
      f('InvoiceDefaultTaxClassificationCode', 'text', {
        zh: '默认税收分类编码',
        en: 'Default tax class code',
      }),
      f('InvoicePiaoTongBaseURL', 'text', {
        zh: '票通接口地址',
        en: 'PiaoTong base URL',
      }),
      f('InvoicePiaoTongPlatformAlias', 'text', {
        zh: '票通平台别名',
        en: 'PiaoTong alias',
      }),
      f('InvoicePiaoTongPlatformCode', 'text', {
        zh: '票通平台代码',
        en: 'PiaoTong code',
      }),
      f('InvoiceQueryMaxAttempts', 'number', {
        zh: '查询最大尝试',
        en: 'Max query attempts',
      }),
      f('InvoiceQueryRetryIntervalSeconds', 'number', {
        zh: '查询重试间隔（秒）',
        en: 'Query retry interval (s)',
      }),
    ],
  },
  {
    id: 'midjourney',
    title: { zh: 'Midjourney', en: 'Midjourney' },
    fields: [
      f('MjAccountFilterEnabled', 'bool', {
        zh: '启用账户过滤',
        en: 'Enable account filter',
      }),
      f('MjActionCheckSuccessEnabled', 'bool', {
        zh: '检查动作成功',
        en: 'Check action success',
      }),
      f('MjForwardUrlEnabled', 'bool', {
        zh: '启用图片转发',
        en: 'Forward image URL',
      }),
      f('MjModeClearEnabled', 'bool', { zh: '清理模式', en: 'Clear mode' }),
      f('MjNotifyEnabled', 'bool', {
        zh: '启用通知',
        en: 'Enable notifications',
      }),
    ],
  },
  {
    id: 'integrations',
    title: { zh: '集成 · Cloudflare Worker / 翻译', en: 'Integrations' },
    fields: [
      f('WorkerUrl', 'text', { zh: 'Worker URL', en: 'Worker URL' }),
      f('WorkerAllowHttpImageRequestEnabled', 'bool', {
        zh: '允许 HTTP 图片',
        en: 'Allow HTTP images',
      }),
      f('TranslationChannelId', 'text', {
        zh: '翻译渠道 ID',
        en: 'Translation channel',
      }),
      f('TranslationModel', 'text', { zh: '翻译模型', en: 'Translation model' }),
      f('TaskEnabled', 'bool', { zh: '启用异步任务', en: 'Enable async tasks' }),
      f('DrawingEnabled', 'bool', { zh: '启用绘图', en: 'Enable drawing' }),
      f('StreamCacheQueueLength', 'number', {
        zh: '流式缓存队列',
        en: 'Stream cache queue length',
      }),
    ],
  },
];

export const SECRET_FIELDS: FieldDef[] = [
  f('SMTPToken', 'secret', { zh: 'SMTP 密码', en: 'SMTP password' }),
  f('GitHubClientSecret', 'secret', {
    zh: 'GitHub client secret',
    en: 'GitHub client secret',
  }),
  f('WeChatServerToken', 'secret', {
    zh: '微信服务器 token',
    en: 'WeChat server token',
  }),
  f('TelegramBotToken', 'secret', {
    zh: 'Telegram bot token',
    en: 'Telegram bot token',
  }),
  f('TurnstileSecretKey', 'secret', {
    zh: 'Turnstile secret',
    en: 'Turnstile secret',
  }),
  f('LinuxDOClientSecret', 'secret', {
    zh: 'LinuxDO client secret',
    en: 'LinuxDO client secret',
  }),
  f('InvoicePiaoTong3DESKey', 'secret', {
    zh: '票通 3DES 密钥',
    en: 'PiaoTong 3DES key',
  }),
  f('InvoicePiaoTongPrivateKey', 'secret', {
    zh: '票通私钥',
    en: 'PiaoTong private key',
  }),
  f('InvoicePiaoTongPublicKey', 'secret', {
    zh: '票通公钥',
    en: 'PiaoTong public key',
  }),
  f('EpayKey', 'secret', { zh: '易支付 key', en: 'Epay key' }),
  f('StripeApiSecret', 'secret', {
    zh: 'Stripe API secret',
    en: 'Stripe API secret',
  }),
  f('StripeWebhookSecret', 'secret', {
    zh: 'Stripe webhook secret',
    en: 'Stripe webhook secret',
  }),
  f('CreemApiKey', 'secret', { zh: 'Creem API key', en: 'Creem API key' }),
  f('CreemWebhookSecret', 'secret', {
    zh: 'Creem webhook secret',
    en: 'Creem webhook secret',
  }),
];

export function allKnownKeys(): Set<string> {
  const s = new Set<string>();
  for (const g of SETTINGS_GROUPS) {
    for (const f of g.fields) s.add(f.key);
  }
  for (const f of SECRET_FIELDS) s.add(f.key);
  return s;
}
