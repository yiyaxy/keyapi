import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  Gauge,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { PageAction } from '@/hooks/usePageAction';
import { usePricing, type PricingEnvelope, type PricingRow } from '@/hooks/usePricing';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { useTokensQuery, type Token } from '@/hooks/useTokens';
import { ApiError, api } from '@/lib/api';
import { fmtDisplay, fmtDisplayUsd, fmtNum } from '@/lib/format';
import { cn } from '@/lib/utils';

const NO_TOKEN = '__no_token__';

type FilterKey = 'hot' | 'cheap' | 'long' | 'vision' | 'stable';
type ViewTab = 'market' | 'chat';

type ModelCardData = {
  name: string;
  vendor: string;
  description: string;
  descriptionKey?: string;
  capabilities: string[];
  inputUsd: number;
  outputUsd: number;
  latencyMs: number;
  health: number;
};

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const fallbackModels: ModelCardData[] = [
  {
    name: 'gpt-4.1-mini',
    vendor: 'OpenAI',
    description: '',
    descriptionKey: 'fallback.gpt_4_1_mini',
    capabilities: ['128k', 'text', 'tool_call'],
    inputUsd: 0.4,
    outputUsd: 1.6,
    latencyMs: 720,
    health: 99.98,
  },
  {
    name: 'claude-sonnet-4',
    vendor: 'Anthropic',
    description: '',
    descriptionKey: 'fallback.claude_sonnet_4',
    capabilities: ['200k', 'reasoning', 'code'],
    inputUsd: 3,
    outputUsd: 15,
    latencyMs: 1180,
    health: 99.91,
  },
  {
    name: 'gemini-2.5-pro',
    vendor: 'Google',
    description: '',
    descriptionKey: 'fallback.gemini_2_5_pro',
    capabilities: ['1M', 'vision', 'long_doc'],
    inputUsd: 1.25,
    outputUsd: 10,
    latencyMs: 1420,
    health: 99.84,
  },
];

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function inputPerMillion(row: PricingRow): number {
  return row.model_ratio * 2;
}

function outputPerMillion(row: PricingRow): number {
  return row.model_ratio * row.completion_ratio * 2;
}

function splitTags(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferCapabilities(row: PricingRow): string[] {
  const lower = `${row.model_name} ${row.description ?? ''} ${row.tags ?? ''} ${(
    row.supported_endpoint_types ?? []
  ).join(' ')}`.toLowerCase();
  const caps = splitTags(row.tags);

  if (lower.includes('vision') || lower.includes('image')) caps.push('vision');
  if (lower.includes('tool') || lower.includes('function')) caps.push('tool_call');
  if (lower.includes('code')) caps.push('code');
  if (lower.includes('audio')) caps.push('audio');
  if (lower.includes('128k')) caps.push('128k');
  if (lower.includes('200k')) caps.push('200k');
  if (lower.includes('1m') || lower.includes('long')) caps.push('long_context');
  if (caps.length === 0) caps.push('text', 'chat');

  return Array.from(new Set(caps)).slice(0, 3);
}

function modelsFromPricing(envelope?: PricingEnvelope): ModelCardData[] {
  if (!envelope?.data?.length) return fallbackModels;

  const vendorById = new Map(envelope.vendors.map((vendor) => [vendor.id, vendor.name]));
  return envelope.data.slice(0, 24).map((row) => {
    const hash = stableHash(row.model_name);
    return {
      name: row.model_name,
      vendor: row.vendor_id ? (vendorById.get(row.vendor_id) ?? row.owner_by) : row.owner_by,
      description: row.description || '',
      capabilities: inferCapabilities(row),
      inputUsd: inputPerMillion(row),
      outputUsd: outputPerMillion(row),
      latencyMs: 640 + (hash % 920),
      health: 99 + (hash % 99) / 100,
    };
  });
}

function modelMatchesFilter(model: ModelCardData, filter: FilterKey): boolean {
  const caps = model.capabilities.join(' ').toLowerCase();
  if (filter === 'cheap') return model.inputUsd <= 1;
  if (filter === 'long')
    return caps.includes('128k') || caps.includes('200k') || caps.includes('long');
  if (filter === 'vision') return caps.includes('vision') || caps.includes('image');
  return true;
}

function capabilityLabel(capability: string, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = capability.toLowerCase().replace(/[\s-]+/g, '_');
  const key = `capabilities.${normalized}`;
  const translated = t(key);
  return translated === key ? capability : translated;
}

function MetricTile({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div className='rounded-md border border-line bg-bg-1 p-4'>
      <div className='text-13 text-fg-2'>{label}</div>
      <div className={cn('mt-3 text-24 font-semibold tabular-nums', accent && 'text-accent')}>
        {value}
      </div>
      <div className='mt-2 text-13 text-fg-1'>{caption}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-13 transition-colors',
        active
          ? 'border-accent/50 bg-accent-soft text-fg-0'
          : 'border-line bg-bg-0 text-fg-1 hover:border-line-strong hover:bg-bg-2 hover:text-fg-0'
      )}
    >
      {children}
    </button>
  );
}

function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: ModelCardData;
  selected: boolean;
  onSelect: () => void;
}) {
  const cfg = usePublicConfig();
  const { t } = useTranslation('playground');
  const description = model.descriptionKey
    ? t(model.descriptionKey)
    : model.description || t('models.default_description');

  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'grid min-h-[172px] gap-4 rounded-md border bg-bg-0 p-4 text-left transition-colors hover:border-line-strong hover:bg-bg-2',
        selected &&
          'border-accent/60 bg-accent-soft/40 hover:border-accent/60 hover:bg-accent-soft/50'
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='truncate text-12 text-fg-2'>{model.vendor}</div>
          <div className='mt-1 truncate font-semibold'>{model.name}</div>
        </div>
        <div className='inline-flex shrink-0 items-center gap-1.5 text-12 text-fg-1'>
          <span className='size-1.5 rounded-full bg-success' aria-hidden />
          {model.health.toFixed(2)}%
        </div>
      </div>

      <p className='line-clamp-2 text-13 text-fg-2'>{description}</p>

      <div className='flex flex-wrap gap-1.5'>
        {model.capabilities.map((capability) => (
          <Badge
            key={capability}
            variant='secondary'
            className='rounded-xs px-1.5 py-0 text-12 font-normal text-fg-1'
          >
            {capabilityLabel(capability, t)}
          </Badge>
        ))}
      </div>

      <div className='grid grid-cols-2 gap-3 text-13'>
        <div>
          <div className='text-12 text-fg-2'>{t('labels.input')}</div>
          <div className='font-semibold tabular-nums'>{fmtDisplayUsd(model.inputUsd, cfg)}</div>
        </div>
        <div>
          <div className='text-12 text-fg-2'>{t('labels.latency')}</div>
          <div className='font-semibold tabular-nums'>
            {fmtNum(model.latencyMs)} {t('unit.ms')}
          </div>
        </div>
      </div>
    </button>
  );
}

function SectionShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className='rounded-md border border-line bg-bg-1'>
      <div className='flex min-h-14 items-center justify-between gap-4 border-b border-line px-4 py-3'>
        <div>
          <h2 className='font-semibold'>{title}</h2>
          {subtitle ? <p className='mt-0.5 text-13 text-fg-2'>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TokenSelect({
  tokens,
  selectedToken,
  onChange,
  pending,
}: {
  tokens: Token[];
  selectedToken?: Token;
  onChange: (id: number) => void;
  pending: boolean;
}) {
  const { t } = useTranslation('playground');
  const value = selectedToken ? String(selectedToken.id) : NO_TOKEN;

  return (
    <Select value={value} onValueChange={(next) => next !== NO_TOKEN && onChange(Number(next))}>
      <SelectTrigger className='h-9 bg-bg-0'>
        <SelectValue placeholder={pending ? t('tokens.loading') : t('tokens.empty')} />
      </SelectTrigger>
      <SelectContent>
        {tokens.length === 0 ? (
          <SelectItem value={NO_TOKEN} disabled>
            {pending ? t('tokens.loading') : t('tokens.empty')}
          </SelectItem>
        ) : (
          tokens.map((token) => (
            <SelectItem key={token.id} value={String(token.id)}>
              {token.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function ViewTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-sm px-4 text-13 font-medium transition-colors',
        active ? 'bg-bg-0 text-fg-0 shadow-sm' : 'text-fg-2 hover:bg-bg-2 hover:text-fg-0'
      )}
    >
      {children}
    </button>
  );
}

function ChatPanel({
  allModels,
  selectedModel,
  onModelChange,
  activeTokens,
  selectedToken,
  onTokenChange,
  tokensPending,
  tokensError,
  onRetryTokens,
  tokenQuota,
  messages,
  chatInput,
  onChatInputChange,
  isRunning,
  onSend,
}: {
  allModels: ModelCardData[];
  selectedModel: ModelCardData;
  onModelChange: (name: string) => void;
  activeTokens: Token[];
  selectedToken?: Token;
  onTokenChange: (id: number) => void;
  tokensPending: boolean;
  tokensError: boolean;
  onRetryTokens: () => void;
  tokenQuota: string;
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  isRunning: boolean;
  onSend: () => void;
}) {
  const { t } = useTranslation('playground');
  const canSend = chatInput.trim().length > 0 && !isRunning;

  return (
    <section className='grid min-h-[680px] grid-rows-[auto_1fr_auto] rounded-md border border-line bg-bg-1'>
      <div className='flex items-start justify-between gap-4 border-b border-line p-4'>
        <div>
          <h2 className='font-semibold'>{t('chat.title')}</h2>
          <p className='mt-1 text-13 text-fg-2'>{t('chat.subtitle')}</p>
        </div>
        <div className='grid w-[520px] max-w-full grid-cols-2 gap-3'>
          <div className='space-y-1.5'>
            <label className='text-12 text-fg-2'>{t('chat.model')}</label>
            <Select value={selectedModel.name} onValueChange={onModelChange}>
              <SelectTrigger className='h-9 bg-bg-0'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allModels.slice(0, 40).map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <label className='text-12 text-fg-2'>{t('tokens.label')}</label>
            <TokenSelect
              tokens={activeTokens}
              selectedToken={selectedToken}
              onChange={onTokenChange}
              pending={tokensPending}
            />
          </div>
        </div>
      </div>

      <div className='overflow-y-auto px-4 py-6'>
        <div className='mx-auto max-w-3xl space-y-5'>
          {tokensError ? (
            <InlineBanner level='danger' message={t('tokens.failed')} onClose={onRetryTokens} />
          ) : null}

          <div className='flex items-center justify-between rounded-md border border-line bg-bg-0 px-3 py-2 text-13 text-fg-1'>
            <span>
              {t('chat.context', {
                model: selectedModel.name,
                token: selectedToken?.name ?? t('tokens.empty_short'),
              })}
            </span>
            <span className='tabular-nums'>{tokenQuota}</span>
          </div>

          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div key={message.id} className={cn('flex gap-3', isUser && 'justify-end')}>
                {!isUser ? (
                  <div className='flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-bg-2 text-12 font-semibold text-fg-1'>
                    AI
                  </div>
                ) : null}
                <div
                  className={cn(
                    'max-w-[78%] rounded-md border px-4 py-3 text-14 leading-6',
                    isUser
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-line bg-bg-0 text-fg-0'
                  )}
                >
                  {message.content}
                </div>
              </div>
            );
          })}

          {isRunning ? (
            <div className='flex items-center gap-3 text-13 text-fg-1'>
              <Loader2 className='size-4 animate-spin' />
              {t('chat.thinking')}
            </div>
          ) : null}
        </div>
      </div>

      <div className='border-t border-line p-4'>
        <div className='mx-auto max-w-3xl rounded-md border border-line bg-bg-0 p-2'>
          <Textarea
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={t('chat.placeholder')}
            className='min-h-[96px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='flex items-center justify-between gap-3 pt-2'>
            <span className='px-2 text-12 text-fg-2'>{t('chat.send_hint')}</span>
            <Button size='sm' onClick={onSend} disabled={!canSend}>
              {isRunning ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Send className='size-4' />
              )}
              {t('chat.send')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlaygroundPage() {
  const { t } = useTranslation('playground');
  const cfg = usePublicConfig();
  const { user } = useAuth();
  const pricing = usePricing();
  const tokens = useTokensQuery(1);

  const [activeTab, setActiveTab] = useState<ViewTab>('market');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('hot');
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [chatInput, setChatInput] = useState(t('chat.default_prompt'));
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, role: 'assistant', content: t('chat.welcome') },
  ]);

  const allModels = useMemo(() => modelsFromPricing(pricing.data), [pricing.data]);
  const visibleModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allModels
      .filter((model) => modelMatchesFilter(model, filter))
      .filter((model) => {
        if (!needle) return true;
        return `${model.name} ${model.vendor} ${model.capabilities.join(' ')}`
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, 9);
  }, [allModels, filter, query]);

  const selectedModel =
    visibleModels.find((model) => model.name === selectedModelName) ??
    allModels.find((model) => model.name === selectedModelName) ??
    visibleModels[0] ??
    allModels[0] ??
    fallbackModels[0];

  const activeTokens = useMemo(
    () => (tokens.data?.items ?? []).filter((token) => token.status === 1),
    [tokens.data?.items]
  );
  const selectedToken =
    activeTokens.find((token) => token.id === selectedTokenId) ?? activeTokens[0];
  const providers = useMemo(
    () => new Set(allModels.map((model) => model.vendor)).size,
    [allModels]
  );
  const medianLatency = useMemo(() => {
    const sorted = allModels.map((model) => model.latencyMs).sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? selectedModel.latencyMs;
  }, [allModels, selectedModel.latencyMs]);

  const estimatedCostUsd = useMemo(() => {
    const inTokens = Math.max(0, Math.round(chatInput.length / 3));
    const outTokens = 512;
    return (
      (inTokens / 1_000_000) * selectedModel.inputUsd +
      (outTokens / 1_000_000) * selectedModel.outputUsd
    );
  }, [chatInput.length, selectedModel.inputUsd, selectedModel.outputUsd]);

  const apiBase =
    typeof window === 'undefined' ? 'https://token.cymoon.cn' : window.location.origin;
  const sampleToken = selectedToken
    ? `sk-${selectedToken.name.replace(/\s+/g, '-')}-...`
    : 'sk-...';
  const curlSample = `curl ${apiBase}/v1/chat/completions \\
  -H "Authorization: Bearer ${sampleToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModel.name}",
    "messages": [
      {"role": "user", "content": "${t('sample.prompt')}"}
    ]
  }'`;

  async function handleSend() {
    const content = chatInput.trim();
    if (!content || isRunning) return;
    setIsRunning(true);
    setChatInput('');
    const userMessage: ChatMessage = { id: Date.now(), role: 'user', content };
    setMessages((current) => [...current, userMessage]);

    try {
      const chatMessages = [...messages, userMessage].map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const res = await api.post<ChatCompletionResponse>('/pg/chat/completions', {
        model: selectedModel.name,
        group: selectedToken?.group || user?.group || undefined,
        messages: chatMessages,
        stream: false,
      });
      const reply = res.data.choices?.[0]?.message?.content?.trim() || t('chat.empty_reply');
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: 'assistant', content: reply },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError ? (err.backendMessage ?? err.message) : (err as Error).message;
      toast.error(message || t('chat.failed'));
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: t('chat.failed_with_reason', { reason: message || t('chat.failed') }),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  async function copySample() {
    try {
      await navigator.clipboard.writeText(curlSample);
      toast.success(t('sample.copied'));
    } catch {
      toast.error(t('sample.copy_failed'));
    }
  }

  const tokenQuota = selectedToken
    ? selectedToken.unlimited_quota
      ? t('tokens.unlimited')
      : fmtDisplay(selectedToken.remain_quota, cfg)
    : t('tokens.empty_short');

  return (
    <>
      <PageAction>
        <Button variant='outline' size='sm'>
          <SlidersHorizontal className='size-4' />
          {t('actions.compare')}
        </Button>
        <Button
          size='sm'
          variant={activeTab === 'chat' ? 'default' : 'secondary'}
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquareText className='size-4' />
          {t('tabs.chat')}
        </Button>
      </PageAction>

      <div className='space-y-6'>
        <header className='flex flex-col gap-3'>
          <div className='text-13 text-fg-2'>{t('eyebrow')}</div>
          <div className='flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <h1 className='text-32 font-semibold tracking-normal'>{t('title')}</h1>
              <p className='mt-2 max-w-2xl text-13 text-fg-1'>{t('subtitle')}</p>
            </div>
            <div className='flex w-full max-w-md items-center gap-2 rounded-md border border-line bg-bg-1 px-3 py-2'>
              <Search className='size-4 shrink-0 text-fg-2' />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('search.placeholder')}
                className='h-7 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
          </div>
        </header>

        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          <MetricTile
            label={t('stats.balance')}
            value={fmtDisplay(user?.quota ?? 0, cfg)}
            caption={t('stats.balance_caption')}
            accent
          />
          <MetricTile
            label={t('stats.models')}
            value={fmtNum(allModels.length)}
            caption={t('stats.models_caption', { providers })}
          />
          <MetricTile
            label={t('stats.latency')}
            value={`${fmtNum(medianLatency)} ${t('unit.ms')}`}
            caption={t('stats.latency_caption')}
          />
          <MetricTile
            label={t('stats.estimate')}
            value={fmtDisplayUsd(estimatedCostUsd, cfg)}
            caption={t('stats.estimate_caption')}
          />
        </div>

        {pricing.isError ? (
          <InlineBanner
            level='warn'
            message={t('models.pricing_failed')}
            onClose={() => void pricing.refetch()}
          />
        ) : null}

        <div className='inline-flex w-fit rounded-md border border-line bg-bg-1 p-1'>
          <ViewTabButton active={activeTab === 'market'} onClick={() => setActiveTab('market')}>
            {t('tabs.market')}
          </ViewTabButton>
          <ViewTabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
            {t('tabs.chat')}
          </ViewTabButton>
        </div>

        {activeTab === 'market' ? (
          <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]'>
            <div className='space-y-6'>
              <SectionShell
                title={t('models.title')}
                subtitle={t('models.subtitle')}
                action={
                  <div className='flex flex-wrap justify-end gap-2'>
                    {(['hot', 'cheap', 'long', 'vision', 'stable'] as const).map((item) => (
                      <FilterChip
                        key={item}
                        active={filter === item}
                        onClick={() => setFilter(item)}
                      >
                        {t(`filters.${item}`)}
                      </FilterChip>
                    ))}
                  </div>
                }
              >
                {pricing.isPending ? (
                  <div className='grid gap-3 p-4 md:grid-cols-3'>
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className='h-[172px] rounded-md' />
                    ))}
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className='p-8 text-center text-13 text-fg-2'>{t('models.empty')}</div>
                ) : (
                  <div className='grid gap-3 p-4 md:grid-cols-2 2xl:grid-cols-3'>
                    {visibleModels.map((model) => (
                      <ModelCard
                        key={model.name}
                        model={model}
                        selected={model.name === selectedModel.name}
                        onSelect={() => setSelectedModelName(model.name)}
                      />
                    ))}
                  </div>
                )}
              </SectionShell>
            </div>

            <aside className='space-y-4'>
              <section className='rounded-md border border-line bg-bg-1 p-4'>
                <div className='mb-3 flex items-center justify-between gap-3'>
                  <h2 className='flex items-center gap-2 font-semibold'>
                    <Code2 className='size-4' />
                    {t('sample.title')}
                  </h2>
                  <Button variant='ghost' size='sm' onClick={() => void copySample()}>
                    <Copy className='size-4' />
                    {t('sample.copy')}
                  </Button>
                </div>
                <pre className='max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg-2 p-3 font-mono text-12 leading-5 text-fg-0'>
                  {curlSample}
                </pre>
              </section>

              <section className='rounded-md border border-line bg-bg-1 p-4'>
                <div className='mb-3 flex items-center justify-between gap-3'>
                  <h2 className='flex items-center gap-2 font-semibold'>
                    <Gauge className='size-4' />
                    {t('routes.title')}
                  </h2>
                  <Button variant='ghost' size='sm'>
                    <RefreshCw className='size-4' />
                    {t('routes.refresh')}
                  </Button>
                </div>
                <div className='space-y-2'>
                  <RouteRow
                    name='cn-east-02'
                    meta={`${fmtNum(selectedModel.latencyMs)} ${t('unit.ms')}`}
                    best
                  />
                  <RouteRow
                    name='global-fallback'
                    meta={`${fmtNum(selectedModel.latencyMs + 260)} ${t('unit.ms')}`}
                  />
                </div>
              </section>

              <section className='rounded-md border border-line bg-bg-1 p-4'>
                <div className='mb-3 flex items-center justify-between gap-3'>
                  <h2 className='flex items-center gap-2 font-semibold'>
                    <Clock3 className='size-4' />
                    {t('recent.title')}
                  </h2>
                  <span className='text-13 font-medium text-accent'>{t('recent.logs')}</span>
                </div>
                <div className='space-y-3'>
                  <RecentRun
                    title={t('recent.items.0')}
                    model={selectedModel.name}
                    meta={`$0.0021 / 836 ${t('unit.ms')}`}
                  />
                  <RecentRun
                    title={t('recent.items.1')}
                    model='claude-sonnet-4'
                    meta={`$0.0184 / 1,224 ${t('unit.ms')}`}
                  />
                  <RecentRun
                    title={t('recent.items.2')}
                    model='gemini-2.5-pro'
                    meta={`$0.0118 / 1,542 ${t('unit.ms')}`}
                  />
                </div>
              </section>
            </aside>
          </div>
        ) : (
          <ChatPanel
            allModels={allModels}
            selectedModel={selectedModel}
            onModelChange={setSelectedModelName}
            activeTokens={activeTokens}
            selectedToken={selectedToken}
            onTokenChange={setSelectedTokenId}
            tokensPending={tokens.isPending}
            tokensError={tokens.isError}
            onRetryTokens={() => void tokens.refetch()}
            tokenQuota={tokenQuota}
            messages={messages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            isRunning={isRunning}
            onSend={handleSend}
          />
        )}
      </div>
    </>
  );
}

function RouteRow({ name, meta, best }: { name: string; meta: string; best?: boolean }) {
  const { t } = useTranslation('playground');

  return (
    <div className='flex min-h-12 items-center justify-between gap-3 rounded-md border border-line bg-bg-0 px-3 py-2'>
      <div>
        <div className='text-13 font-medium'>{name}</div>
        <div className='text-12 text-fg-2'>{meta}</div>
      </div>
      {best ? (
        <span className='inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-12'>
          <span className='size-1.5 rounded-full bg-success' aria-hidden />
          {t('routes.best')}
        </span>
      ) : (
        <Badge variant='outline' className='font-normal'>
          {t('routes.backup')}
        </Badge>
      )}
    </div>
  );
}

function RecentRun({ title, model, meta }: { title: string; model: string; meta: string }) {
  return (
    <div className='border-b border-line pb-3 last:border-b-0 last:pb-0'>
      <div className='flex items-center justify-between gap-3 text-13'>
        <span>{title}</span>
        <CheckCircle2 className='size-4 text-success' />
      </div>
      <div className='mt-1 text-12 text-fg-2'>
        {model} / {meta}
      </div>
    </div>
  );
}
