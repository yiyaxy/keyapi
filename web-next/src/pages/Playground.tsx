import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Code2,
  Copy,
  Download,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TerminalSquare,
} from 'lucide-react';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { PageAction } from '@/hooks/usePageAction';
import { usePricing, type PricingEnvelope, type PricingRow } from '@/hooks/usePricing';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { useTokensQuery, type Token } from '@/hooks/useTokens';
import { ApiError, api } from '@/lib/api';
import { fmtDisplay, fmtDisplayUsd, fmtNum } from '@/lib/format';
import { cn } from '@/lib/utils';

const NO_TOKEN = '__no_token__';
const PLAYGROUND_REQUEST_TIMEOUT_MS = 60_000;
const PLAYGROUND_IMAGE_TIMEOUT_MS = 180_000;

type FilterKey = 'hot' | 'cheap' | 'long' | 'vision' | 'image' | 'stable';
type EndpointKey = 'chat' | 'responses' | 'images' | 'embeddings' | 'rerank';

type EndpointConfig = {
  endpointType: string;
  publicPath: string;
  playgroundPath: string;
  labelKey: string;
  shortLabelKey: string;
};

type ModelCardData = {
  name: string;
  vendor: string;
  description: string;
  descriptionKey?: string;
  capabilities: string[];
  endpointTypes: string[];
  inputUsd: number;
  outputUsd: number;
  imageUsd: number;
  latencyMs: number;
  health: number;
};

type ImageResult = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

type RunResult = {
  raw: string;
  text?: string;
  images?: ImageResult[];
};

type PlaygroundRunResponse =
  | Record<string, unknown>
  | Array<unknown>
  | string
  | number
  | boolean
  | null;

const endpointOrder: EndpointKey[] = ['chat', 'responses', 'images', 'embeddings', 'rerank'];

const endpointConfigs: Record<EndpointKey, EndpointConfig> = {
  chat: {
    endpointType: 'openai',
    publicPath: '/v1/chat/completions',
    playgroundPath: '/pg/chat/completions',
    labelKey: 'endpoint.chat',
    shortLabelKey: 'endpoint.short.chat',
  },
  responses: {
    endpointType: 'openai-response',
    publicPath: '/v1/responses',
    playgroundPath: '/pg/responses',
    labelKey: 'endpoint.responses',
    shortLabelKey: 'endpoint.short.responses',
  },
  images: {
    endpointType: 'image-generation',
    publicPath: '/v1/images/generations',
    playgroundPath: '/pg/images/generations',
    labelKey: 'endpoint.images',
    shortLabelKey: 'endpoint.short.images',
  },
  embeddings: {
    endpointType: 'embeddings',
    publicPath: '/v1/embeddings',
    playgroundPath: '/pg/embeddings',
    labelKey: 'endpoint.embeddings',
    shortLabelKey: 'endpoint.short.embeddings',
  },
  rerank: {
    endpointType: 'jina-rerank',
    publicPath: '/v1/rerank',
    playgroundPath: '/pg/rerank',
    labelKey: 'endpoint.rerank',
    shortLabelKey: 'endpoint.short.rerank',
  },
};

const fallbackModels: ModelCardData[] = [
  {
    name: 'gpt-4.1-mini',
    vendor: 'OpenAI',
    description: '',
    descriptionKey: 'fallback.gpt_4_1_mini',
    capabilities: ['128k', 'text', 'tool_call'],
    endpointTypes: ['openai', 'openai-response'],
    inputUsd: 0.4,
    outputUsd: 1.6,
    imageUsd: 0,
    latencyMs: 720,
    health: 99.98,
  },
  {
    name: 'gpt-image-2',
    vendor: 'OpenAI',
    description: '',
    descriptionKey: 'fallback.gpt_image_2',
    capabilities: ['image_generation', 'vision'],
    endpointTypes: ['image-generation'],
    inputUsd: 0,
    outputUsd: 0,
    imageUsd: 0.04,
    latencyMs: 1680,
    health: 99.9,
  },
  {
    name: 'claude-sonnet-4',
    vendor: 'Anthropic',
    description: '',
    descriptionKey: 'fallback.claude_sonnet_4',
    capabilities: ['200k', 'reasoning', 'code'],
    endpointTypes: ['openai', 'anthropic'],
    inputUsd: 3,
    outputUsd: 15,
    imageUsd: 0,
    latencyMs: 1180,
    health: 99.91,
  },
  {
    name: 'gemini-2.5-pro',
    vendor: 'Google',
    description: '',
    descriptionKey: 'fallback.gemini_2_5_pro',
    capabilities: ['1M', 'vision', 'long_doc'],
    endpointTypes: ['openai', 'gemini'],
    inputUsd: 1.25,
    outputUsd: 10,
    imageUsd: 0,
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
  const endpointTypes = row.supported_endpoint_types ?? [];
  const lower = `${row.model_name} ${row.description ?? ''} ${row.tags ?? ''} ${endpointTypes.join(
    ' '
  )}`.toLowerCase();
  const caps = splitTags(row.tags);

  if (endpointTypes.includes('image-generation')) caps.push('image_generation');
  if (endpointTypes.includes('embeddings')) caps.push('embeddings');
  if (endpointTypes.includes('jina-rerank')) caps.push('rerank');
  if (endpointTypes.includes('openai-response')) caps.push('responses');
  if (lower.includes('vision')) caps.push('vision');
  if (lower.includes('image') && !caps.includes('image_generation')) caps.push('vision');
  if (lower.includes('tool') || lower.includes('function')) caps.push('tool_call');
  if (lower.includes('code')) caps.push('code');
  if (lower.includes('audio')) caps.push('audio');
  if (lower.includes('128k')) caps.push('128k');
  if (lower.includes('200k')) caps.push('200k');
  if (lower.includes('1m') || lower.includes('long')) caps.push('long_context');
  if (caps.length === 0) caps.push('text', 'chat');

  return Array.from(new Set(caps)).slice(0, 4);
}

function modelsFromPricing(envelope?: PricingEnvelope): ModelCardData[] {
  if (!envelope?.data?.length) return fallbackModels;

  const vendorById = new Map(envelope.vendors.map((vendor) => [vendor.id, vendor.name]));
  return envelope.data.map((row) => {
    const hash = stableHash(row.model_name);
    return {
      name: row.model_name,
      vendor: row.vendor_id ? (vendorById.get(row.vendor_id) ?? row.owner_by) : row.owner_by,
      description: row.description || '',
      capabilities: inferCapabilities(row),
      endpointTypes: row.supported_endpoint_types?.length
        ? row.supported_endpoint_types
        : ['openai'],
      inputUsd: inputPerMillion(row),
      outputUsd: outputPerMillion(row),
      imageUsd: row.image_ratio ?? 0,
      latencyMs: 640 + (hash % 920),
      health: 99 + (hash % 99) / 100,
    };
  });
}

function endpointKeysForModel(model: ModelCardData): EndpointKey[] {
  const endpointTypes = new Set(model.endpointTypes);
  const keys = endpointOrder.filter((key) => endpointTypes.has(endpointConfigs[key].endpointType));
  return keys.length ? keys : ['chat'];
}

function endpointKeyForType(endpointType: string): EndpointKey | undefined {
  return endpointOrder.find((key) => endpointConfigs[key].endpointType === endpointType);
}

function preferredEndpointForModel(model: ModelCardData): EndpointKey {
  const keys = endpointKeysForModel(model);
  for (const endpointType of model.endpointTypes) {
    const key = endpointKeyForType(endpointType);
    if (key && keys.includes(key)) return key;
  }
  return keys[0] ?? 'chat';
}

function modelMatchesFilter(model: ModelCardData, filter: FilterKey): boolean {
  const caps = model.capabilities.join(' ').toLowerCase();
  const endpoints = model.endpointTypes.join(' ').toLowerCase();
  if (filter === 'cheap')
    return model.inputUsd <= 1 || (model.imageUsd > 0 && model.imageUsd <= 0.05);
  if (filter === 'long')
    return caps.includes('128k') || caps.includes('200k') || caps.includes('long');
  if (filter === 'vision') return caps.includes('vision');
  if (filter === 'image')
    return caps.includes('image_generation') || endpoints.includes('image-generation');
  return true;
}

function capabilityLabel(capability: string, t: ReturnType<typeof useTranslation>['t']): string {
  const normalized = capability.toLowerCase().replace(/[\s-]+/g, '_');
  const key = `capabilities.${normalized}`;
  const translated = t(key);
  return translated === key ? capability : translated;
}

function imageSrc(item: ImageResult): string | null {
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return null;
}

function imageExtension(src: string): string {
  const dataMatch = src.match(/^data:image\/([^;,]+)/);
  if (dataMatch?.[1]) return dataMatch[1].replace('jpeg', 'jpg');
  const pathMatch = src.split('?')[0]?.match(/\.([a-z0-9]+)$/i);
  return pathMatch?.[1] ?? 'png';
}

function triggerImageDownload(src: string, filename: string) {
  const link = document.createElement('a');
  link.href = src;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadGeneratedImage(src: string, index: number) {
  const filename = `generated-image-${index + 1}.${imageExtension(src)}`;
  if (src.startsWith('data:')) {
    triggerImageDownload(src, filename);
    return;
  }

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
    const blobUrl = URL.createObjectURL(await response.blob());
    triggerImageDownload(blobUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    triggerImageDownload(src, filename);
  }
}

function formatRaw(data: PlaygroundRunResponse): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

function extractRunResult(endpoint: EndpointKey, data: PlaygroundRunResponse): RunResult {
  const raw = formatRaw(data);
  if (endpoint === 'images') {
    const items =
      data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
    return { raw, images: items as ImageResult[] };
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const choices = data.choices;
    if (Array.isArray(choices)) {
      const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
      const content = first?.message?.content ?? first?.text;
      if (typeof content === 'string') return { raw, text: content };
    }
    if (typeof data.output_text === 'string') return { raw, text: data.output_text };
  }

  return { raw };
}

function buildRequestPayload({
  endpoint,
  model,
  prompt,
  group,
  imageSize,
  imageQuality,
  imageCount,
  responseFormat,
}: {
  endpoint: EndpointKey;
  model: string;
  prompt: string;
  group?: string;
  imageSize: string;
  imageQuality: string;
  imageCount: number;
  responseFormat: string;
}) {
  const base = {
    model,
    ...(group ? { group } : {}),
  };

  if (endpoint === 'images') {
    return {
      ...base,
      prompt,
      size: imageSize,
      quality: imageQuality,
      n: imageCount,
      response_format: responseFormat,
    };
  }

  if (endpoint === 'responses') {
    return {
      ...base,
      input: prompt,
    };
  }

  if (endpoint === 'embeddings') {
    return {
      ...base,
      input: prompt,
    };
  }

  if (endpoint === 'rerank') {
    return {
      ...base,
      query: prompt,
      documents: [
        'The gateway routes requests to the best available channel.',
        'Billing records usage after each completed request.',
        'Image models should use the image generation endpoint.',
      ],
    };
  }

  return {
    ...base,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
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

function ModelRow({
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

  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border p-3 text-left transition-colors hover:border-line-strong hover:bg-bg-2',
        selected ? 'border-accent/60 bg-accent-soft/50' : 'border-line bg-bg-0'
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='truncate text-12 text-fg-2'>{model.vendor}</div>
          <div className='mt-1 truncate text-14 font-semibold'>{model.name}</div>
        </div>
        <div className='shrink-0 text-12 font-medium tabular-nums text-fg-1'>
          {model.imageUsd > 0
            ? fmtDisplayUsd(model.imageUsd, cfg)
            : fmtDisplayUsd(model.inputUsd, cfg)}
        </div>
      </div>
      <div className='mt-3 flex flex-wrap gap-1.5'>
        {model.capabilities.slice(0, 3).map((capability) => (
          <Badge
            key={capability}
            variant='secondary'
            className='rounded-xs px-1.5 py-0 text-12 font-normal text-fg-1'
          >
            {capabilityLabel(capability, t)}
          </Badge>
        ))}
      </div>
    </button>
  );
}

function ModelBrowser({
  models,
  selectedModel,
  filter,
  onFilterChange,
  onModelSelect,
  pending,
}: {
  models: ModelCardData[];
  selectedModel: ModelCardData;
  filter: FilterKey;
  onFilterChange: (filter: FilterKey) => void;
  onModelSelect: (model: ModelCardData) => void;
  pending: boolean;
}) {
  const { t } = useTranslation('playground');

  return (
    <SectionShell title={t('models.title')} subtitle={t('models.subtitle')}>
      <div className='space-y-3 p-4'>
        <div className='flex flex-wrap gap-2'>
          {(['hot', 'cheap', 'long', 'vision', 'image', 'stable'] as const).map((item) => (
            <FilterChip key={item} active={filter === item} onClick={() => onFilterChange(item)}>
              {t(`filters.${item}`)}
            </FilterChip>
          ))}
        </div>
        {pending ? (
          <div className='space-y-2'>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className='h-[92px] rounded-md' />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div className='rounded-md border border-line bg-bg-0 p-8 text-center text-13 text-fg-2'>
            {t('models.empty')}
          </div>
        ) : (
          <div className='max-h-[720px] space-y-2 overflow-y-auto pr-1'>
            {models.map((model) => (
              <ModelRow
                key={model.name}
                model={model}
                selected={model.name === selectedModel.name}
                onSelect={() => onModelSelect(model)}
              />
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

function EndpointButton({
  endpoint,
  active,
  disabled,
  onClick,
}: {
  endpoint: EndpointKey;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('playground');

  return (
    <button
      type='button'
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-9 rounded-sm px-3 text-13 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-bg-0 text-fg-0 shadow-sm' : 'text-fg-2 hover:bg-bg-2 hover:text-fg-0'
      )}
    >
      {t(endpointConfigs[endpoint].shortLabelKey)}
    </button>
  );
}

function ResultPanel({ endpoint, result }: { endpoint: EndpointKey; result: RunResult | null }) {
  const { t } = useTranslation('playground');
  const isImage = endpoint === 'images';
  const images = result?.images?.map(imageSrc).filter((src): src is string => Boolean(src)) ?? [];
  const [preview, setPreview] = useState<{ src: string; index: number } | null>(null);
  const previewLabel = preview
    ? t('use.generated_image_alt', { index: preview.index + 1 })
    : t('use.preview_image');

  if (!result) {
    return (
      <div className='flex min-h-[260px] items-center justify-center rounded-md border border-dashed border-line bg-bg-0 text-center text-13 text-fg-2'>
        <div>
          <ImageIcon className='mx-auto mb-3 size-8 text-fg-1' />
          {t(isImage ? 'use.result_empty_image' : 'use.result_empty')}
        </div>
      </div>
    );
  }

  if (isImage && images.length > 0) {
    return (
      <>
        <TooltipProvider delayDuration={150}>
          <div className='grid gap-3 sm:grid-cols-2'>
            {images.map((src, index) => (
              <div
                key={src}
                className='group relative overflow-hidden rounded-md border border-line bg-bg-0'
              >
                <button
                  type='button'
                  onClick={() => setPreview({ src, index })}
                  className='block w-full cursor-zoom-in text-left'
                  aria-label={t('use.preview_image')}
                >
                  <img
                    src={src}
                    alt={t('use.generated_image_alt', { index: index + 1 })}
                    className='aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]'
                  />
                </button>
                <div className='absolute right-2 top-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100'>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        size='icon'
                        variant='secondary'
                        className='size-8 bg-bg-1/90 shadow-sm backdrop-blur'
                        onClick={() => setPreview({ src, index })}
                        aria-label={t('use.preview_image')}
                      >
                        <Maximize2 className='size-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('use.preview_image')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        size='icon'
                        variant='secondary'
                        className='size-8 bg-bg-1/90 shadow-sm backdrop-blur'
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadGeneratedImage(src, index);
                        }}
                        aria-label={t('use.download_image')}
                      >
                        <Download className='size-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('use.download_image')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </TooltipProvider>
        <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className='max-h-[92vh] max-w-[min(96vw,1120px)] overflow-hidden border-line bg-bg-1 p-0'>
            <DialogTitle className='sr-only'>{previewLabel}</DialogTitle>
            {preview ? (
              <>
                <div className='flex min-h-14 items-center justify-end border-b border-line px-4 py-3 pr-14'>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => void downloadGeneratedImage(preview.src, preview.index)}
                  >
                    <Download className='size-4' />
                    {t('use.download_image')}
                  </Button>
                </div>
                <div className='max-h-[calc(92vh-56px)] overflow-auto bg-bg-0 p-3'>
                  <img
                    src={preview.src}
                    alt={previewLabel}
                    className='mx-auto max-h-[calc(92vh-80px)] max-w-full rounded-sm object-contain'
                  />
                </div>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <pre className='max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg-0 p-4 font-mono text-12 leading-5 text-fg-0'>
      {result.text ?? result.raw}
    </pre>
  );
}

function UseWorkbench({
  allModels,
  selectedModel,
  selectedEndpoint,
  availableEndpoints,
  prompt,
  imageSize,
  imageQuality,
  imageCount,
  responseFormat,
  isRunning,
  result,
  onModelChange,
  onEndpointChange,
  onPromptChange,
  onImageSizeChange,
  onImageQualityChange,
  onImageCountChange,
  onResponseFormatChange,
  onRun,
}: {
  allModels: ModelCardData[];
  selectedModel: ModelCardData;
  selectedEndpoint: EndpointKey;
  availableEndpoints: EndpointKey[];
  prompt: string;
  imageSize: string;
  imageQuality: string;
  imageCount: number;
  responseFormat: string;
  isRunning: boolean;
  result: RunResult | null;
  onModelChange: (name: string) => void;
  onEndpointChange: (endpoint: EndpointKey) => void;
  onPromptChange: (value: string) => void;
  onImageSizeChange: (value: string) => void;
  onImageQualityChange: (value: string) => void;
  onImageCountChange: (value: number) => void;
  onResponseFormatChange: (value: string) => void;
  onRun: () => void;
}) {
  const { t } = useTranslation('playground');
  const canRun = prompt.trim().length > 0 && !isRunning;
  const isImage = selectedEndpoint === 'images';

  return (
    <section className='grid min-h-[720px] grid-rows-[auto_auto_1fr] rounded-md border border-line bg-bg-1'>
      <div className='flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <h2 className='font-semibold'>{t('use.title')}</h2>
          <p className='mt-1 text-13 text-fg-2'>
            {selectedModel.vendor} / {selectedModel.name}
          </p>
        </div>
        <div className='w-full lg:w-[340px]'>
          <label className='mb-1.5 block text-12 text-fg-2'>{t('use.model')}</label>
          <Select value={selectedModel.name} onValueChange={onModelChange}>
            <SelectTrigger className='h-9 bg-bg-0'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allModels.slice(0, 120).map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='border-b border-line p-4'>
        <div className='inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-bg-2 p-1'>
          {endpointOrder.map((endpoint) => (
            <EndpointButton
              key={endpoint}
              endpoint={endpoint}
              active={selectedEndpoint === endpoint}
              disabled={!availableEndpoints.includes(endpoint)}
              onClick={() => onEndpointChange(endpoint)}
            />
          ))}
        </div>
      </div>

      <div className='grid gap-4 p-4'>
        <div className='rounded-md border border-line bg-bg-0 p-3'>
          <div className='mb-2 flex items-center justify-between gap-3'>
            <label className='text-12 font-medium uppercase tracking-normal text-fg-2'>
              {t('use.prompt')}
            </label>
            <Badge variant='outline' className='font-normal'>
              {t(endpointConfigs[selectedEndpoint].labelKey)}
            </Badge>
          </div>
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={t(`use.placeholder.${selectedEndpoint}`)}
            className='min-h-[180px] resize-none border-0 bg-transparent text-14 leading-6 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div className='mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-4'>
            {isImage ? (
              <>
                <div className='space-y-1.5'>
                  <label className='text-12 text-fg-2'>{t('use.size')}</label>
                  <Select value={imageSize} onValueChange={onImageSizeChange}>
                    <SelectTrigger className='h-9 bg-bg-1'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='1024x1024'>1024x1024</SelectItem>
                      <SelectItem value='1024x1792'>1024x1792</SelectItem>
                      <SelectItem value='1792x1024'>1792x1024</SelectItem>
                      <SelectItem value='512x512'>512x512</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <label className='text-12 text-fg-2'>{t('use.quality')}</label>
                  <Select value={imageQuality} onValueChange={onImageQualityChange}>
                    <SelectTrigger className='h-9 bg-bg-1'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='auto'>auto</SelectItem>
                      <SelectItem value='standard'>standard</SelectItem>
                      <SelectItem value='hd'>hd</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <label className='text-12 text-fg-2'>{t('use.count')}</label>
                  <Input
                    type='number'
                    min={1}
                    max={4}
                    value={imageCount}
                    onChange={(event) =>
                      onImageCountChange(Math.min(4, Math.max(1, Number(event.target.value) || 1)))
                    }
                    className='h-9 bg-bg-1'
                  />
                </div>
                <div className='space-y-1.5'>
                  <label className='text-12 text-fg-2'>{t('use.format')}</label>
                  <Select value={responseFormat} onValueChange={onResponseFormatChange}>
                    <SelectTrigger className='h-9 bg-bg-1'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='url'>url</SelectItem>
                      <SelectItem value='b64_json'>b64_json</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <InfoPill
                  label={t('use.endpoint')}
                  value={endpointConfigs[selectedEndpoint].publicPath}
                />
                <InfoPill
                  label={t('labels.input')}
                  value={fmtNum(Math.max(1, Math.round(prompt.length / 3)))}
                />
                <InfoPill label={t('use.mode')} value={t(`endpoint.short.${selectedEndpoint}`)} />
                <InfoPill
                  label={t('use.stream')}
                  value={selectedEndpoint === 'chat' ? 'false' : '-'}
                />
              </>
            )}
          </div>
          <div className='mt-3 flex justify-end'>
            <Button onClick={onRun} disabled={!canRun}>
              {isRunning ? (
                <Loader2 className='size-4 animate-spin' />
              ) : isImage ? (
                <ImageIcon className='size-4' />
              ) : (
                <Play className='size-4' />
              )}
              {isImage ? t('use.run_image') : t('use.run')}
            </Button>
          </div>
        </div>

        <ResultPanel endpoint={selectedEndpoint} result={result} />
      </div>
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border border-line bg-bg-1 px-3 py-2'>
      <div className='text-12 text-fg-2'>{label}</div>
      <div className='mt-1 truncate text-13 font-medium'>{value}</div>
    </div>
  );
}

function InspectorPanel({
  activeTokens,
  selectedToken,
  onTokenChange,
  tokensPending,
  tokensError,
  onRetryTokens,
  tokenQuota,
  curlSample,
  selectedModel,
  selectedEndpoint,
  onCopySample,
}: {
  activeTokens: Token[];
  selectedToken?: Token;
  onTokenChange: (id: number) => void;
  tokensPending: boolean;
  tokensError: boolean;
  onRetryTokens: () => void;
  tokenQuota: string;
  curlSample: string;
  selectedModel: ModelCardData;
  selectedEndpoint: EndpointKey;
  onCopySample: () => void;
}) {
  const { t } = useTranslation('playground');

  return (
    <aside className='space-y-4'>
      {tokensError ? (
        <InlineBanner level='danger' message={t('tokens.failed')} onClose={onRetryTokens} />
      ) : null}

      <section className='rounded-md border border-line bg-bg-1 p-4'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h2 className='flex items-center gap-2 font-semibold'>
            <Layers3 className='size-4' />
            {t('use.context')}
          </h2>
          <Badge variant='outline' className='font-normal'>
            {t(endpointConfigs[selectedEndpoint].shortLabelKey)}
          </Badge>
        </div>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <label className='text-12 text-fg-2'>{t('tokens.label')}</label>
            <TokenSelect
              tokens={activeTokens}
              selectedToken={selectedToken}
              onChange={onTokenChange}
              pending={tokensPending}
            />
          </div>
          <div className='grid grid-cols-2 gap-2 text-13'>
            <InfoPill label={t('tokens.quota')} value={tokenQuota} />
            <InfoPill
              label={t('labels.latency')}
              value={`${fmtNum(selectedModel.latencyMs)} ${t('unit.ms')}`}
            />
          </div>
        </div>
      </section>

      <section className='rounded-md border border-line bg-bg-1 p-4'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h2 className='flex items-center gap-2 font-semibold'>
            <TerminalSquare className='size-4' />
            {t('sample.title')}
          </h2>
          <Button variant='ghost' size='sm' onClick={onCopySample}>
            <Copy className='size-4' />
            {t('sample.copy')}
          </Button>
        </div>
        <pre className='max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg-2 p-3 font-mono text-12 leading-5 text-fg-0'>
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
    </aside>
  );
}

export function PlaygroundPage() {
  const { t } = useTranslation('playground');
  const cfg = usePublicConfig();
  const { user } = useAuth();
  const pricing = usePricing();
  const tokens = useTokensQuery(1);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('hot');
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState<EndpointKey>('chat');
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState(t('use.default_prompt'));
  const [imageSize, setImageSize] = useState('1024x1024');
  const [imageQuality, setImageQuality] = useState('auto');
  const [imageCount, setImageCount] = useState(1);
  const [responseFormat, setResponseFormat] = useState('url');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const allModels = useMemo(() => modelsFromPricing(pricing.data), [pricing.data]);
  const visibleModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allModels
      .filter((model) => modelMatchesFilter(model, filter))
      .filter((model) => {
        if (!needle) return true;
        return `${model.name} ${model.vendor} ${model.capabilities.join(' ')} ${model.endpointTypes.join(
          ' '
        )}`
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, 80);
  }, [allModels, filter, query]);

  const selectedModel =
    visibleModels.find((model) => model.name === selectedModelName) ??
    allModels.find((model) => model.name === selectedModelName) ??
    visibleModels[0] ??
    allModels[0] ??
    fallbackModels[0];

  const availableEndpoints = useMemo(() => endpointKeysForModel(selectedModel), [selectedModel]);
  const selectedEndpoint = availableEndpoints.includes(endpointDraft)
    ? endpointDraft
    : preferredEndpointForModel(selectedModel);

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
  const endpointCount = useMemo(
    () => new Set(allModels.flatMap((model) => model.endpointTypes)).size,
    [allModels]
  );

  const estimatedCostUsd = useMemo(() => {
    if (selectedEndpoint === 'images') {
      return Math.max(selectedModel.imageUsd, selectedModel.inputUsd) * imageCount;
    }
    const inTokens = Math.max(0, Math.round(prompt.length / 3));
    const outTokens = selectedEndpoint === 'embeddings' ? 0 : 512;
    return (
      (inTokens / 1_000_000) * selectedModel.inputUsd +
      (outTokens / 1_000_000) * selectedModel.outputUsd
    );
  }, [
    imageCount,
    prompt.length,
    selectedEndpoint,
    selectedModel.imageUsd,
    selectedModel.inputUsd,
    selectedModel.outputUsd,
  ]);

  const tokenQuota = selectedToken
    ? selectedToken.unlimited_quota
      ? t('tokens.unlimited')
      : fmtDisplay(selectedToken.remain_quota, cfg)
    : t('tokens.empty_short');

  const publicPayload = useMemo(
    () =>
      buildRequestPayload({
        endpoint: selectedEndpoint,
        model: selectedModel.name,
        prompt: prompt || t('sample.prompt'),
        imageSize,
        imageQuality,
        imageCount,
        responseFormat,
      }),
    [
      imageCount,
      imageQuality,
      imageSize,
      prompt,
      responseFormat,
      selectedEndpoint,
      selectedModel.name,
      t,
    ]
  );

  const apiBase =
    typeof window === 'undefined' ? 'https://token.cymoon.cn' : window.location.origin;
  const sampleToken =
    selectedToken?.key ||
    (selectedToken ? `sk-${selectedToken.name.replace(/\s+/g, '-')}-...` : 'sk-...');
  const curlSample = `curl ${apiBase}${endpointConfigs[selectedEndpoint].publicPath} \\
  -H "Authorization: Bearer ${sampleToken}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(publicPayload, null, 2)}'`;

  function handleModelSelect(model: ModelCardData) {
    setSelectedModelName(model.name);
    setEndpointDraft(preferredEndpointForModel(model));
    setRunResult(null);
  }

  async function handleRun() {
    const content = prompt.trim();
    if (!content || isRunning) return;
    setIsRunning(true);
    setRunResult(null);

    const payload = buildRequestPayload({
      endpoint: selectedEndpoint,
      model: selectedModel.name,
      prompt: content,
      group: selectedToken?.group || user?.group || undefined,
      imageSize,
      imageQuality,
      imageCount,
      responseFormat,
    });

    try {
      const res = await api.post<PlaygroundRunResponse>(
        endpointConfigs[selectedEndpoint].playgroundPath,
        payload,
        {
          rawEnvelope: true,
          timeout:
            selectedEndpoint === 'images'
              ? PLAYGROUND_IMAGE_TIMEOUT_MS
              : PLAYGROUND_REQUEST_TIMEOUT_MS,
        } as never
      );
      setRunResult(extractRunResult(selectedEndpoint, res.data));
      toast.success(t('use.run_success'));
    } catch (err) {
      const message =
        err instanceof ApiError ? (err.backendMessage ?? err.message) : (err as Error).message;
      toast.error(message || t('use.run_failed'));
      setRunResult({
        raw: t('use.run_failed_with_reason', { reason: message || t('use.run_failed') }),
      });
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

  return (
    <>
      <PageAction>
        <Button variant='outline' size='sm'>
          <SlidersHorizontal className='size-4' />
          {t('actions.compare')}
        </Button>
        <Button size='sm' variant='secondary'>
          <Code2 className='size-4' />
          {t(endpointConfigs[selectedEndpoint].shortLabelKey)}
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
            label={t('stats.endpoints')}
            value={fmtNum(endpointCount)}
            caption={t('stats.endpoints_caption')}
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

        <div className='grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_360px]'>
          <ModelBrowser
            models={visibleModels}
            selectedModel={selectedModel}
            filter={filter}
            onFilterChange={setFilter}
            onModelSelect={handleModelSelect}
            pending={pricing.isPending}
          />
          <UseWorkbench
            allModels={allModels}
            selectedModel={selectedModel}
            selectedEndpoint={selectedEndpoint}
            availableEndpoints={availableEndpoints}
            prompt={prompt}
            imageSize={imageSize}
            imageQuality={imageQuality}
            imageCount={imageCount}
            responseFormat={responseFormat}
            isRunning={isRunning}
            result={runResult}
            onModelChange={(name) => {
              const next = allModels.find((model) => model.name === name);
              if (next) handleModelSelect(next);
            }}
            onEndpointChange={(endpoint) => {
              setEndpointDraft(endpoint);
              setRunResult(null);
            }}
            onPromptChange={setPrompt}
            onImageSizeChange={setImageSize}
            onImageQualityChange={setImageQuality}
            onImageCountChange={setImageCount}
            onResponseFormatChange={setResponseFormat}
            onRun={handleRun}
          />
          <InspectorPanel
            activeTokens={activeTokens}
            selectedToken={selectedToken}
            onTokenChange={setSelectedTokenId}
            tokensPending={tokens.isPending}
            tokensError={tokens.isError}
            onRetryTokens={() => void tokens.refetch()}
            tokenQuota={tokenQuota}
            curlSample={curlSample}
            selectedModel={selectedModel}
            selectedEndpoint={selectedEndpoint}
            onCopySample={() => void copySample()}
          />
        </div>
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
