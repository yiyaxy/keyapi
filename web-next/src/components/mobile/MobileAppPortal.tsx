import {
  ArrowLeft,
  ArrowRight,
  Bot,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  LogIn,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { RechargeCard } from '@/components/topup/RechargeCard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { type AiApp, useGetSessionToken, usePublicApps } from '@/hooks/useAiApps';
import { usePricing, type PricingEnvelope, type PricingRow } from '@/hooks/usePricing';
import { toDisplay, usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type MobileRoute = 'home' | 'apps' | 'topup';
type ModelKind = 'chat' | 'image';

type MobileModel = {
  name: string;
  displayName: string;
  vendor: string;
  kind: ModelKind;
  description: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
};

type StoredChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  kind: ModelKind;
  model: string;
  model_display_name: string;
  content: string;
  images?: string[];
  created_at: number;
};

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

function currentTimestamp() {
  return Date.now();
}

function pointsFromQuota(rawQuota: number, cfg: PublicConfig): string {
  const { value } = toDisplay(rawQuota, cfg);
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value * 1000)));
}

function resolveAssetUrl(url: string): string {
  const value = url.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value.startsWith('/') ? value : `/${value}`, window.location.origin).toString();
}

function launchApp(app: AiApp, key: string) {
  const targetUrl = new URL(app.target_url, window.location.origin);
  if (targetUrl.origin === window.location.origin) {
    targetUrl.searchParams.set('token', key);
    window.location.href = targetUrl.toString();
    return;
  }

  const loginUrl = new URL('/api/auth/token-login', targetUrl);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = loginUrl.toString();
  form.style.display = 'none';

  const tokenInput = document.createElement('input');
  tokenInput.type = 'hidden';
  tokenInput.name = 'token';
  tokenInput.value = key;
  form.append(tokenInput);

  const callbackInput = document.createElement('input');
  callbackInput.type = 'hidden';
  callbackInput.name = 'callbackUrl';
  callbackInput.value = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  form.append(callbackInput);

  document.body.append(form);
  form.submit();
}

function modelKind(row: PricingRow): ModelKind {
  const endpoints = row.supported_endpoint_types ?? [];
  const lower = `${row.model_name} ${row.description ?? ''} ${row.tags ?? ''}`.toLowerCase();
  if (endpoints.includes('image-generation')) return 'image';
  if (
    lower.includes('image') &&
    !endpoints.includes('openai') &&
    !endpoints.includes('openai-response')
  ) {
    return 'image';
  }
  return 'chat';
}

function modelDisplayName(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized === 'gemini-3-pro-image-preview') return 'Nano Banana Pro';
  if (normalized === 'gemini-3.1-flash-image-preview') return 'Nano Banana 2';
  if (normalized === 'gemini-2.5-flash-image-preview') return 'Nano Banana';
  return modelName;
}

function modelsFromPricing(envelope?: PricingEnvelope): MobileModel[] {
  const rows = envelope?.data ?? [];
  if (rows.length === 0) {
    return [
      {
        name: 'gpt-4.1-mini',
        displayName: 'gpt-4.1-mini',
        vendor: 'OpenAI',
        kind: 'chat',
        description: '轻量、快速、适合日常对话',
      },
      {
        name: 'gpt-image-1',
        displayName: 'gpt-image-1',
        vendor: 'OpenAI',
        kind: 'image',
        description: '图片生成模型',
      },
    ];
  }

  const vendorById = new Map((envelope?.vendors ?? []).map((vendor) => [vendor.id, vendor.name]));
  return rows.map((row) => ({
    name: row.model_name,
    displayName: modelDisplayName(row.model_name),
    vendor: row.vendor_id ? (vendorById.get(row.vendor_id) ?? row.owner_by) : row.owner_by,
    kind: modelKind(row),
    description: row.description || (modelKind(row) === 'image' ? '图片生成模型' : '大语言模型'),
  }));
}

function extractChatText(data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const body = data as Record<string, unknown>;
    if (typeof body.output_text === 'string') return body.output_text;
    const choices = body.choices;
    if (Array.isArray(choices)) {
      const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
      const content = first?.message?.content ?? first?.text;
      if (typeof content === 'string') return content;
    }
  }
  if (typeof data === 'string') return data;
  return '模型已返回结果，但当前页面无法解析为文本。';
}

function extractImageUrls(data: unknown): string[] {
  const items =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : Array.isArray(data)
        ? data
        : [];

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const image = item as { url?: unknown; b64_json?: unknown };
      if (typeof image.url === 'string') return image.url;
      if (typeof image.b64_json === 'string') return `data:image/png;base64,${image.b64_json}`;
      return '';
    })
    .filter(Boolean);
}

function LoginRequired() {
  const location = useLocation();
  const redirect = encodeURIComponent(location.pathname + location.search);
  return (
    <main className='min-h-screen bg-bg-1 px-4 py-8 text-fg-0'>
      <section className='mx-auto flex min-h-[72vh] max-w-md flex-col justify-center'>
        <div className='rounded-lg border border-line bg-bg-0 p-6 shadow-sm'>
          <div className='mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary'>
            <LogIn className='h-6 w-6' />
          </div>
          <h1 className='text-24 font-semibold'>登录后使用 AI 应用</h1>
          <p className='mt-2 text-14 leading-6 text-fg-2'>
            新用户使用微信小程序扫码登录会自动注册，并领取赠送积分。
          </p>
          <Button className='mt-6 h-11 w-full' asChild>
            <Link to={`/login?redirect=${redirect}`}>前往登录</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function MobileHeader({
  title,
  subtitle,
  backTo,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
}) {
  const { refresh } = useAuth();
  return (
    <header className='sticky top-0 z-10 border-b border-line bg-bg-0/95 px-4 py-3 backdrop-blur'>
      <div className='mx-auto flex max-w-md items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          {backTo ? (
            <Link
              to={backTo}
              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-bg-1'
            >
              <ArrowLeft className='h-4 w-4' />
            </Link>
          ) : null}
          <div className='min-w-0'>
            <p className='text-11 uppercase tracking-[0.18em] text-fg-3'>MOBILE AI</p>
            <h1 className='truncate text-18 font-semibold'>{title}</h1>
            {subtitle ? <p className='truncate text-12 text-fg-2'>{subtitle}</p> : null}
          </div>
        </div>
        <Button size='sm' variant='secondary' className='shrink-0' onClick={() => void refresh()}>
          <RefreshCw className='h-4 w-4' />
        </Button>
      </div>
    </header>
  );
}

function PointsCard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const cfg = usePublicConfig();
  if (!user) return null;
  if (compact) {
    return (
      <section className='rounded-lg border border-line bg-bg-0 px-3 py-2.5 shadow-sm'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <p className='text-11 text-fg-2'>可用积分</p>
            <div className='truncate text-20 font-semibold tabular-nums'>
              {pointsFromQuota(user.quota, cfg)}
            </div>
          </div>
          <div className='flex shrink-0 gap-2'>
            <Link
              to='/m/apps'
              className='inline-flex h-9 items-center justify-center rounded-md border border-line bg-bg-1 px-3 text-12 font-medium text-fg-1'
            >
              应用
            </Link>
            <Link
              to='/m/topup'
              className='inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-12 font-medium text-primary-foreground'
            >
              充值
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className='rounded-lg border border-line bg-bg-0 p-4 shadow-sm'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-12 text-fg-2'>可用积分</p>
          <div className={cn('mt-1 font-semibold tabular-nums', compact ? 'text-24' : 'text-30')}>
            {pointsFromQuota(user.quota, cfg)}
          </div>
          <p className='mt-1 text-12 text-fg-3'>账号：{user.display_name || user.username}</p>
        </div>
        <div className='rounded-md bg-primary/10 p-3 text-primary'>
          <WalletCards className='h-5 w-5' />
        </div>
      </div>
      <p className='mt-4 rounded-md bg-primary/5 px-3 py-2 text-12 text-fg-2'>
        新用户扫码登录自动注册，赠送积分到账后可直接使用应用。
      </p>
    </section>
  );
}

function MobileAppCard({
  app,
  compact = false,
  onSessionInvalid,
}: {
  app: AiApp;
  compact?: boolean;
  onSessionInvalid: () => void;
}) {
  const tokenMutation = useGetSessionToken(app.slug);
  const tags = app.tags
    ? app.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, compact ? 2 : 3)
    : [];

  async function handleUse() {
    try {
      await api.get('/api/user/self');
      const res = await tokenMutation.mutateAsync();
      if (!res.key) throw new Error('missing app token');
      launchApp(app, res.key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionInvalid();
        return;
      }
      toast.error('应用启动失败，请稍后重试');
    }
  }

  return (
    <button
      type='button'
      onClick={() => void handleUse()}
      disabled={tokenMutation.isPending}
      className='group w-full overflow-hidden rounded-lg border border-line bg-bg-0 p-3.5 text-left shadow-sm transition active:scale-[0.99] disabled:opacity-70'
    >
      <div className='flex items-start gap-3'>
        {app.icon_url ? (
          <img
            src={resolveAssetUrl(app.icon_url)}
            alt=''
            className='h-11 w-11 shrink-0 rounded-md object-cover'
          />
        ) : (
          <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xl font-semibold text-primary'>
            {app.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <h3 className='min-w-0 flex-1 truncate text-15 font-semibold text-fg-0'>{app.name}</h3>
            {tokenMutation.isPending ? (
              <Loader2 className='h-4 w-4 shrink-0 animate-spin text-fg-2' />
            ) : (
              <ArrowRight className='h-4 w-4 shrink-0 text-fg-2 transition group-active:translate-x-0.5' />
            )}
          </div>
          <p
            className={cn(
              'mt-1 text-12 leading-5 text-fg-2',
              compact ? 'line-clamp-1' : 'line-clamp-2'
            )}
          >
            {app.description || '这个应用暂未填写介绍'}
          </p>
        </div>
      </div>
      {tags.length > 0 ? (
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {tags.map((tag) => (
            <span key={tag} className='rounded-full bg-bg-2 px-2 py-1 text-11 text-fg-2'>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

function MobileChat({
  immersive = false,
  onEnterChatMode,
  onExitChatMode,
}: {
  immersive?: boolean;
  onEnterChatMode?: () => void;
  onExitChatMode?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pricing = usePricing();
  const [kind, setKind] = useState<ModelKind>('chat');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);

  const models = useMemo(() => modelsFromPricing(pricing.data), [pricing.data]);
  const chatModels = models.filter((model) => model.kind === 'chat');
  const imageModels = models.filter((model) => model.kind === 'image');
  const visibleModels = kind === 'chat' ? chatModels : imageModels;
  const selectedModel =
    visibleModels.find((model) => model.name === selectedModelName) ??
    chatModels.find((model) => model.name === selectedModelName) ??
    visibleModels.find((model) => model.name === 'gpt-5.5') ??
    chatModels.find((model) => model.name === 'gpt-5.5') ??
    visibleModels[0] ??
    chatModels[0];

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await api.get<{ items: StoredChatMessage[] }>('/api/app/mobile-chat/messages');
        if (cancelled) return;
        const items = res.data.items ?? [];
        setMessages(
          items.map((item) => ({
            id: `db-${item.id}`,
            role: item.role,
            content: item.content,
            images: item.images ?? [],
          }))
        );
        if (items.length > 0) onEnterChatMode?.();
      } catch {
        /* history is optional */
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [onEnterChatMode]);

  function persistMessage(message: ChatMessage, model: MobileModel, messageKind: ModelKind) {
    void api.post('/api/app/mobile-chat/messages', {
      role: message.role,
      kind: messageKind,
      model: model.name,
      model_display_name: model.displayName,
      content: message.content,
      images: message.images ?? [],
      created_at: currentTimestamp(),
    });
  }

  async function startNewChat() {
    if (running) return;

    setMessages([]);
    setInput('');
    setModelPickerOpen(false);
    try {
      await api.delete('/api/app/mobile-chat/messages');
      toast.success('已开启新对话');
    } catch {
      toast.error('新对话已开启，但历史清理失败');
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || running || !selectedModel) return;

    const userMessage: ChatMessage = { id: createMessageId('u'), role: 'user', content };
    onEnterChatMode?.();
    setMessages((prev) => [...prev, userMessage]);
    persistMessage(userMessage, selectedModel, kind);
    setInput('');
    setRunning(true);

    try {
      const res =
        kind === 'image'
          ? await api.post<unknown>(
              '/pg/images/generations',
              {
                model: selectedModel.name,
                group: user?.group || undefined,
                prompt: content,
                size: '1024x1024',
                n: 1,
                response_format: 'url',
              },
              { rawEnvelope: true, timeout: 180_000 } as never
            )
          : await api.post<unknown>(
              '/pg/chat/completions',
              {
                model: selectedModel.name,
                group: user?.group || undefined,
                messages: [...messages, userMessage].slice(-8).map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
                stream: false,
              },
              { rawEnvelope: true, timeout: 60_000 } as never
            );
      const imageUrls = kind === 'image' ? extractImageUrls(res.data) : [];
      const reply: ChatMessage = {
        id: createMessageId('a'),
        role: 'assistant',
        content:
          kind === 'image'
            ? imageUrls.length > 0
              ? '图片已生成'
              : '图片模型已返回结果，但当前页面没有拿到可展示的图片地址。'
            : extractChatText(res.data),
        images: imageUrls,
      };
      setMessages((prev) => [...prev, reply]);
      persistMessage(reply, selectedModel, kind);
    } catch (err) {
      const msg = err instanceof ApiError ? (err.backendMessage ?? err.message) : '对话请求失败';
      toast.error(msg);
      const errorMessage: ChatMessage = {
        id: createMessageId('e'),
        role: 'assistant',
        content: `请求失败：${msg}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
      persistMessage(errorMessage, selectedModel, kind);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section
      className={cn(
        'rounded-lg border border-line bg-bg-0 p-4 shadow-sm',
        immersive ? 'min-h-[calc(100vh-96px)]' : ''
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            {immersive ? (
              <button
                type='button'
                onClick={onExitChatMode}
                className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
                aria-label='返回'
              >
                <ArrowLeft className='h-4 w-4' />
              </button>
            ) : null}
            <MessageCircle className='h-4 w-4 text-primary' />
            <div className='min-w-0'>
              <h2 className='truncate text-17 font-semibold'>与大模型对话</h2>
              {immersive && selectedModel ? (
                <p className='truncate text-11 text-fg-2'>{selectedModel.displayName}</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {pricing.isPending ? <Loader2 className='h-4 w-4 animate-spin text-fg-2' /> : null}
          {immersive ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='flex h-9 w-9 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
                  aria-label='打开菜单'
                >
                  <Menu className='h-4 w-4' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-44'>
                <DropdownMenuItem onSelect={() => void startNewChat()} disabled={running}>
                  <Plus className='h-4 w-4' />
                  新开对话
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowHistory(true)}>
                  <History className='h-4 w-4' />
                  历史记录
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShowUserInfo(true)}>
                  <UserRound className='h-4 w-4' />
                  用户信息
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/m/apps')}>
                  <LayoutGrid className='h-4 w-4' />
                  AI 应用
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onExitChatMode}>
                  <ArrowLeft className='h-4 w-4' />
                  返回工作台
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <>
        {messages.length > 0 || running ? (
          <div
            className={cn(
              'mt-4 space-y-3 overflow-y-auto rounded-md bg-bg-1 p-3',
              immersive ? 'max-h-[calc(100vh-300px)] min-h-[48vh]' : 'max-h-72'
            )}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[86%] whitespace-pre-wrap rounded-lg px-3 py-2 text-13 leading-6',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-line bg-bg-0 text-fg-0'
                  )}
                >
                  <div>{message.content}</div>
                  {message.images?.length ? (
                    <div className='mt-2 grid gap-2'>
                      {message.images.map((src) => (
                        <img
                          key={src}
                          src={src}
                          alt='Generated'
                          className='max-h-72 w-full rounded-md object-cover'
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {running ? (
              <div className='flex justify-start'>
                <div className='inline-flex items-center gap-2 rounded-lg border border-line bg-bg-0 px-3 py-2 text-13 text-fg-2'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  {kind === 'image' ? '生成中' : '思考中'}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedModel ? (
          <div className='mt-3'>
            <button
              type='button'
              onClick={() => setModelPickerOpen((open) => !open)}
              className='flex w-full items-center justify-between gap-3 rounded-md border border-line bg-bg-1 px-3 py-2 text-left'
            >
              <div className='min-w-0'>
                <p className='text-11 text-fg-2'>当前模型</p>
                <div className='mt-0.5 flex min-w-0 items-center gap-2'>
                  <span className='truncate font-mono text-12 font-medium text-fg-0'>
                    {selectedModel.displayName}
                  </span>
                  <span className='shrink-0 rounded-full bg-bg-0 px-2 py-0.5 text-11 text-fg-2'>
                    {selectedModel.kind === 'chat' ? '大语言模型' : '图片模型'}
                  </span>
                </div>
              </div>
              <ArrowRight
                className={cn(
                  'h-4 w-4 shrink-0 text-fg-2 transition',
                  modelPickerOpen ? 'rotate-90' : ''
                )}
              />
            </button>

            {modelPickerOpen ? (
              <div className='mt-2 rounded-md border border-line bg-bg-0 p-2'>
                <div className='grid grid-cols-2 gap-2 rounded-md bg-bg-1 p-1'>
                  {(
                    [
                      { value: 'chat', label: '大语言模型', icon: Bot, count: chatModels.length },
                      {
                        value: 'image',
                        label: '图片模型',
                        icon: ImageIcon,
                        count: imageModels.length,
                      },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.value}
                        type='button'
                        onClick={() => setKind(item.value)}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded px-2 py-2 text-12 font-medium transition',
                          kind === item.value ? 'bg-bg-0 text-fg-0 shadow-sm' : 'text-fg-2'
                        )}
                      >
                        <Icon className='h-3.5 w-3.5' />
                        {item.label}
                        <span className='text-11 text-fg-3'>{item.count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className='mt-2 max-h-44 space-y-1 overflow-y-auto'>
                  {visibleModels.slice(0, 50).map((model) => (
                    <button
                      key={model.name}
                      type='button'
                      onClick={() => {
                        setSelectedModelName(model.name);
                        setModelPickerOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-12 transition',
                        selectedModel.name === model.name
                          ? 'bg-primary/10 text-fg-0'
                          : 'text-fg-2 hover:bg-bg-1'
                      )}
                    >
                      <span className='min-w-0 truncate font-mono'>{model.displayName}</span>
                      <span className='shrink-0 text-11 text-fg-3'>{model.vendor}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className='mt-3 space-y-2'>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              kind === 'image'
                ? '描述图片：一张适合小程序分享卡片的海报...'
                : '问问模型：帮我写一段小程序介绍...'
            }
            className='min-h-20 resize-none'
          />
          <Button
            className='h-10 w-full'
            onClick={() => void send()}
            disabled={running || !input.trim()}
          >
            {running ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />}
            {kind === 'image' ? '生成图片' : '发送'}
          </Button>
        </div>
      </>
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className='max-h-[82vh] w-[calc(100vw-32px)] max-w-md overflow-hidden rounded-lg p-0'>
          <DialogHeader className='border-b border-line px-4 py-3 text-left'>
            <DialogTitle className='text-16'>历史记录</DialogTitle>
          </DialogHeader>
          <div className='max-h-[68vh] space-y-3 overflow-y-auto p-4'>
            {messages.length === 0 ? (
              <div className='rounded-md border border-line bg-bg-1 p-5 text-center text-13 text-fg-2'>
                暂无对话记录
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className='rounded-md border border-line bg-bg-1 p-3'>
                  <div className='mb-1 text-11 font-medium text-fg-2'>
                    {message.role === 'user' ? '我' : 'AI'}
                  </div>
                  <p className='line-clamp-4 whitespace-pre-wrap text-13 leading-6 text-fg-0'>
                    {message.content || '图片结果'}
                  </p>
                  {message.images?.length ? (
                    <div className='mt-2 text-12 text-fg-2'>图片 {message.images.length} 张</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showUserInfo} onOpenChange={setShowUserInfo}>
        <DialogContent className='w-[calc(100vw-32px)] max-w-md rounded-lg'>
          <DialogHeader>
            <DialogTitle>用户信息</DialogTitle>
          </DialogHeader>
          <div className='space-y-3 text-13'>
            <div className='rounded-md border border-line bg-bg-1 p-3'>
              <div className='text-11 text-fg-2'>账号</div>
              <div className='mt-1 font-medium text-fg-0'>
                {user?.display_name || user?.username || '当前用户'}
              </div>
            </div>
            <div className='rounded-md border border-line bg-bg-1 p-3'>
              <div className='text-11 text-fg-2'>用户组</div>
              <div className='mt-1 font-medium text-fg-0'>{user?.group || '默认分组'}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RecommendedApps({ limit, showMore = false }: { limit?: number; showMore?: boolean }) {
  const { refresh } = useAuth();
  const appsQuery = usePublicApps();
  const apps = limit ? (appsQuery.data ?? []).slice(0, limit) : (appsQuery.data ?? []);

  async function onSessionInvalid() {
    toast.error('登录已失效，请重新登录');
    await refresh();
    window.location.href = '/login?redirect=/m';
  }

  return (
    <section className='space-y-3'>
      <div className='flex items-end justify-between gap-3'>
        <div>
          <h2 className='text-17 font-semibold'>应用推荐</h2>
          <p className='text-12 text-fg-2'>点击应用直接进入使用流程。</p>
        </div>
        {showMore ? (
          <Link to='/m/apps' className='text-12 font-medium text-primary'>
            全部应用
          </Link>
        ) : null}
      </div>
      {appsQuery.isPending ? (
        <div className='space-y-3'>
          {Array.from({ length: limit ?? 4 }).map((_, i) => (
            <Skeleton key={i} className='h-24 rounded-lg' />
          ))}
        </div>
      ) : appsQuery.isError ? (
        <div className='rounded-lg border border-danger/30 bg-danger/5 p-4 text-13 text-danger'>
          应用列表加载失败，请稍后重试。
        </div>
      ) : apps.length === 0 ? (
        <div className='rounded-lg border border-line bg-bg-0 p-6 text-center text-13 text-fg-2'>
          暂无可用应用
        </div>
      ) : (
        <div className='space-y-3'>
          {apps.map((app) => (
            <MobileAppCard
              key={app.id}
              app={app}
              compact={Boolean(limit)}
              onSessionInvalid={() => void onSessionInvalid()}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MobileChatEntryCard() {
  return (
    <section className='rounded-lg border border-primary/20 bg-primary/5 p-4 shadow-sm'>
      <div className='flex items-start gap-3'>
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground'>
          <MessageCircle className='h-5 w-5' />
        </div>
        <div className='min-w-0 flex-1'>
          <h2 className='text-16 font-semibold'>与大模型对话</h2>
          <p className='mt-1 text-12 leading-5 text-fg-2'>选择模型直接聊天，也可以生成图片。</p>
        </div>
      </div>
      <Button className='mt-4 h-10 w-full' asChild>
        <Link to='/m'>开始对话</Link>
      </Button>
    </section>
  );
}

export function MobileHomePage() {
  const { user } = useAuth();
  const [chatMode, setChatMode] = useState(false);
  const enterChatMode = useCallback(() => setChatMode(true), []);
  const exitChatMode = useCallback(() => setChatMode(false), []);
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-1 pb-10 text-fg-0'>
      {chatMode ? null : <MobileHeader title='AI 工作台' subtitle='对话、应用和积分充值' />}
      <div className='mx-auto max-w-md space-y-4 px-4 py-4'>
        {chatMode ? null : <PointsCard compact />}
        <MobileChat
          immersive={chatMode}
          onEnterChatMode={enterChatMode}
          onExitChatMode={exitChatMode}
        />
        {chatMode ? null : <RecommendedApps limit={3} showMore />}
      </div>
    </main>
  );
}

export function MobileAppsPage() {
  const { user } = useAuth();
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-1 pb-10 text-fg-0'>
      <MobileHeader title='AI 应用' subtitle='选择应用后直接启动' backTo='/m' />
      <div className='mx-auto max-w-md space-y-5 px-4 py-4'>
        <MobileChatEntryCard />
        <RecommendedApps />
      </div>
    </main>
  );
}

export function MobileTopupPage() {
  const { user } = useAuth();
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-1 pb-10 text-fg-0'>
      <MobileHeader title='充值积分' subtitle='积分不足时在这里补充' backTo='/m' />
      <div className='mx-auto max-w-md space-y-5 px-4 py-4'>
        <PointsCard compact />
        <RechargeCard />
      </div>
    </main>
  );
}

export function MobileRoutePage({ route }: { route: MobileRoute }) {
  if (route === 'apps') return <MobileAppsPage />;
  if (route === 'topup') return <MobileTopupPage />;
  return <MobileHomePage />;
}
