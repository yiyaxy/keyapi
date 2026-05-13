import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
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
  Upload,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MarkdownContent } from '@/components/common/MarkdownContent';
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
import {
  type AiApp,
  uploadAiAppImages,
  useGetSessionToken,
  usePublicApps,
} from '@/hooks/useAiApps';
import { usePricing, type PricingEnvelope, type PricingRow } from '@/hooks/usePricing';
import { toDisplay, usePublicConfig, type PublicConfig } from '@/hooks/usePublicConfig';
import { api, ApiError } from '@/lib/api';
import { filterMarketplaceApps } from '@/lib/aiAppVisibility';
import { getLlmRequestHeaders, getLlmTenantId, LLM_BASE_URL, llmUrl } from '@/lib/llm';
import { cn } from '@/lib/utils';

type MobileRoute = 'home' | 'apps' | 'chat' | 'topup';
type ModelKind = 'chat' | 'image';
type MobileImageResolution = '1k' | '2k' | '4k' | 'auto';

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
  createdAt: number;
};

type AttachedImage = {
  id: string;
  file: File;
  previewUrl: string;
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

function storedMessageToChatMessage(item: StoredChatMessage): ChatMessage {
  return {
    id: `db-${item.id}`,
    role: item.role,
    content: item.content,
    images: item.images ?? [],
    createdAt: item.created_at,
  };
}

type HistoryEntry = {
  id: string;
  createdAt: number;
  user?: ChatMessage;
  assistant?: ChatMessage;
};

function messageSequence(message: ChatMessage) {
  const raw = message.id.startsWith('db-') ? message.id.slice(3) : message.id.split('-').pop();
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function compareMessagesDesc(a: ChatMessage, b: ChatMessage) {
  return b.createdAt - a.createdAt || messageSequence(b) - messageSequence(a);
}

function buildHistoryEntries(recordsDesc: ChatMessage[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let current: HistoryEntry | null = null;
  const sortedDesc = [...recordsDesc].sort(compareMessagesDesc);

  for (const message of sortedDesc.reverse()) {
    if (message.role === 'user') {
      if (current) entries.push(current);
      current = {
        id: message.id,
        createdAt: message.createdAt,
        user: message,
      };
      continue;
    }

    if (current && !current.assistant) {
      current.assistant = message;
      current.id = `${current.id}-${message.id}`;
      current.createdAt = Math.max(current.createdAt, message.createdAt);
    } else {
      if (current) entries.push(current);
      current = {
        id: message.id,
        createdAt: message.createdAt,
        assistant: message,
      };
    }
  }

  if (current) entries.push(current);
  return entries.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

const MAX_ATTACHED_IMAGES = 16;
const CHAT_INITIAL_LIMIT = 30;
const HISTORY_PAGE_SIZE = 20;
const DEFAULT_MOBILE_IMAGE_COUNT = 1;
const DEFAULT_MOBILE_IMAGE_RESOLUTION: MobileImageResolution = '1k';
const MOBILE_IMAGE_APP_SLUG = import.meta.env.VITE_IMAGE_DIAGNOSIS_APP_SLUG ?? 'image-diagnosis';
const MOBILE_CHAT_APP_SLUG = import.meta.env.VITE_MOBILE_CHAT_APP_SLUG ?? MOBILE_IMAGE_APP_SLUG;
const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  chat: '大语言模型',
  image: '图片模型',
};
const MOBILE_IMAGE_COUNT_OPTIONS = [1, 2, 4] as const;
const MOBILE_IMAGE_RESOLUTION_OPTIONS: Array<{ value: MobileImageResolution; label: string }> = [
  { value: '1k', label: '1k' },
  { value: '2k', label: '2k' },
  { value: '4k', label: '4k' },
  { value: 'auto', label: '自动' },
];

function pointsFromQuota(rawQuota: number, cfg: PublicConfig): string {
  const { value } = toDisplay(rawQuota, cfg);
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value * 1000)));
}

function resolveAssetUrl(url: string): string {
  const value = url.trim();
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  return new URL(value.startsWith('/') ? value : `/${value}`, window.location.origin).toString();
}

function shouldAttachLlmBaseUrl(app: AiApp) {
  const value = `${app.slug} ${app.target_url}`.toLowerCase();
  return value.includes('noterx');
}

function persistSameOriginNoterxConfig(targetUrl: URL, key: string) {
  sessionStorage.setItem('noterx.session_token', key);
  const llmBaseUrl = targetUrl.searchParams.get('llm_base_url');
  if (llmBaseUrl) sessionStorage.setItem('noterx.llm_base_url', llmBaseUrl);
  const tenantId = targetUrl.searchParams.get('tenant_id');
  if (tenantId) sessionStorage.setItem('noterx.tenant_id', tenantId);
}

function getSessionKey(res: { key?: string; data?: { key?: string } }) {
  return res.key || res.data?.key || '';
}

function launchApp(app: AiApp, key: string) {
  const targetUrl = new URL(app.target_url, window.location.origin);
  const isNoteRx = shouldAttachLlmBaseUrl(app);
  if (isNoteRx) {
    targetUrl.searchParams.set('llm_base_url', LLM_BASE_URL);
    targetUrl.searchParams.set('token', key);
    const tenantId = getLlmTenantId();
    if (tenantId) targetUrl.searchParams.set('tenant_id', String(tenantId));
    if (targetUrl.origin === window.location.origin) {
      persistSameOriginNoterxConfig(targetUrl, key);
    }
    window.location.href = targetUrl.toString();
    return;
  }
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
  const modelName = row.model_name.toLowerCase();
  const lower = `${modelName} ${row.description ?? ''} ${row.tags ?? ''}`.toLowerCase();
  if (endpoints.includes('image-generation')) return 'image';
  if (
    [
      'gpt-image',
      'dall-e',
      'imagen',
      'flux',
      'stable-diffusion',
      'sdxl',
      'midjourney',
      'seedream',
      'jimeng',
      'kling',
      'kolors',
      'recraft',
      'ideogram',
      'wanx',
      'cogview',
      'dreamina',
      'nano-banana',
      'image-preview',
    ].some((keyword) => modelName.includes(keyword))
  ) {
    return 'image';
  }
  if (
    lower.includes('图片生成') ||
    lower.includes('图像生成') ||
    lower.includes('image generation')
  ) {
    return 'image';
  }
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
        name: 'gpt-image-2',
        displayName: 'gpt-image-2',
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

function stringifyChatContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const item = part as { text?: unknown; content?: unknown };
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    })
    .join('');
}

function extractChatStreamDelta(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const body = data as {
    choices?: Array<{
      delta?: { content?: unknown; reasoning_content?: unknown };
      message?: { content?: unknown };
      text?: unknown;
    }>;
    delta?: unknown;
    output_text?: unknown;
  };
  if (typeof body.output_text === 'string') return body.output_text;
  const choices = body.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        const content = choice.delta?.content ?? choice.message?.content ?? choice.text;
        return stringifyChatContent(content);
      })
      .join('');
  }
  return stringifyChatContent(body.delta);
}

function parseChatStreamLine(line: string): { done: boolean; text: string } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return { done: false, text: '' };
  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!payload) return { done: false, text: '' };
  if (payload === '[DONE]') return { done: true, text: '' };
  try {
    return { done: false, text: extractChatStreamDelta(JSON.parse(payload)) };
  } catch {
    return { done: false, text: '' };
  }
}

function extractImageItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const body = data as { data?: unknown; result?: unknown };
  if (Array.isArray(body.data)) return body.data;
  if (body.result) return extractImageItems(body.result);
  return [];
}

function extractImageUrls(data: unknown): string[] {
  return extractImageItems(data)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const image = item as { url?: unknown; b64_json?: unknown };
      if (typeof image.url === 'string') return image.url;
      if (typeof image.b64_json === 'string' && image.b64_json) {
        return `data:image/png;base64,${image.b64_json}`;
      }
      return '';
    })
    .filter(Boolean);
}

type AsyncImageTaskResponse = {
  task_id?: string;
  status?: string;
  progress?: number | string;
  result?: unknown;
  error?: {
    message?: string;
  } | null;
};

async function uploadMobileReferenceImages(
  images: AttachedImage[],
  onUploaded: (done: number, total: number) => void
): Promise<string[]> {
  return uploadAiAppImages(
    images.map((image) => image.file),
    onUploaded
  );
}

function parseAsyncSubmitResponse(body: unknown) {
  const taskId =
    (body as { task_id?: string }).task_id ??
    (body as { data?: { task_id?: string } }).data?.task_id ??
    (body as { data?: Array<{ task_id?: string }> }).data?.[0]?.task_id;
  if (!taskId) throw new Error('异步图片接口返回异常：缺少 task_id');
  return taskId;
}

function normalizeAsyncImageStatus(status?: string) {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete'].includes(value)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(value)) return 'failed';
  if (['processing', 'running', 'in_progress'].includes(value)) return 'running';
  return 'queued';
}

function normalizeAsyncImageProgress(progress: AsyncImageTaskResponse['progress'], status: string) {
  if (status === 'succeeded' || status === 'failed') return 100;
  if (typeof progress === 'number' && Number.isFinite(progress))
    return Math.max(10, Math.min(95, progress));
  if (typeof progress === 'string') {
    const parsed = Number.parseInt(progress.replace('%', ''), 10);
    if (Number.isFinite(parsed)) return Math.max(10, Math.min(95, parsed));
  }
  return status === 'queued' ? 20 : 60;
}

function asyncImageStatusMessage(status: string, progress: number) {
  if (status === 'queued') return '图片任务排队中';
  if (status === 'running') return `图片生成中 ${progress}%`;
  if (status === 'succeeded') return '图片已生成';
  return '图片生成失败';
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function safeReadResponseError(response: Response) {
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      const message =
        (body as { message?: unknown }).message ??
        (body as { error?: { message?: unknown } }).error?.message ??
        (body as { error?: unknown }).error;
      if (typeof message === 'string') return message;
      return JSON.stringify(body);
    }
  } catch {
    /* fall through */
  }
  try {
    return await response.text();
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function normalizeRelayToken(token: string) {
  const value = token.trim();
  if (!value || value === 'sk-preview') return '';
  return value.startsWith('sk-') ? value : `sk-${value}`;
}

async function getMobileRelayToken(appSlug: string, cacheNamespace: string, errorMessage: string) {
  const params = new URLSearchParams(window.location.search);
  const urlToken = normalizeRelayToken(params.get('token') || params.get('key') || '');
  if (urlToken) return urlToken;

  if (import.meta.env.DEV) {
    const debugToken = normalizeRelayToken(
      window.localStorage.getItem('image-diagnosis-debug-token') ?? ''
    );
    if (debugToken) return debugToken;
  }

  const cacheKey = `${cacheNamespace}-token:${appSlug}`;
  const cached = normalizeRelayToken(window.sessionStorage.getItem(cacheKey) ?? '');
  if (cached) return cached;

  const session = await api.post<{ key: string }>(`/api/app/${appSlug}/session`);
  const token = normalizeRelayToken(session.data.key ?? '');
  if (!token) throw new Error(errorMessage);
  window.sessionStorage.setItem(cacheKey, token);
  return token;
}

async function getMobileChatRelayToken() {
  return getMobileRelayToken(MOBILE_CHAT_APP_SLUG, 'mobile-chat', '没有拿到大语言模型调用凭证');
}

async function getMobileImageRelayToken() {
  return getMobileRelayToken(MOBILE_IMAGE_APP_SLUG, 'image-diagnosis', '没有拿到图片模型调用凭证');
}

async function submitMobileChatCompletion({
  token,
  model,
  messages,
  onText,
}: {
  token: string;
  model: string;
  messages: Array<{ role: ChatMessage['role']; content: string }>;
  onText: (text: string) => void;
}) {
  const response = await fetch(llmUrl('/chat/completions'), {
    method: 'POST',
    headers: getLlmRequestHeaders(token),
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });
  if (!response.ok) {
    throw new Error(await safeReadResponseError(response));
  }
  if (!response.body) {
    const data = await response.json();
    const text = extractChatText(data);
    onText(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : (lines.pop() ?? '');

    for (const line of lines) {
      const parsed = parseChatStreamLine(line);
      if (parsed.done) {
        reader.releaseLock();
        return text;
      }
      if (!parsed.text) continue;
      text += parsed.text;
      onText(text);
    }

    if (done) break;
  }

  if (buffer) {
    const parsed = parseChatStreamLine(buffer);
    if (parsed.text) {
      text += parsed.text;
      onText(text);
    }
  }
  reader.releaseLock();
  return text;
}

function protectedAsyncImageRequestUrl(src: string) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return '';
  try {
    const url = new URL(src, window.location.origin);
    if (url.pathname.startsWith('/v1/images/async/') && url.pathname.includes('/content/')) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return '';
  }
  return '';
}

async function fetchMobileImageObjectUrl(src: string) {
  const requestUrl = protectedAsyncImageRequestUrl(src);
  if (!requestUrl) return src;

  let response = await fetch(requestUrl, { credentials: 'include' });
  if (
    !response.ok &&
    (response.status === 401 || response.status === 403 || response.status === 404)
  ) {
    const token = await getMobileImageRelayToken();
    response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }
  if (!response.ok) {
    throw new Error(`图片加载失败：${await safeReadResponseError(response)}`);
  }
  return URL.createObjectURL(await response.blob());
}

function MobileGeneratedImage({
  src,
  alt = 'Generated image',
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [loading, setLoading] = useState(Boolean(protectedAsyncImageRequestUrl(src)));
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    async function loadImage() {
      setLoading(Boolean(protectedAsyncImageRequestUrl(src)));
      setLoadError(false);
      try {
        const nextSrc = await fetchMobileImageObjectUrl(src);
        if (cancelled) {
          if (nextSrc.startsWith('blob:')) URL.revokeObjectURL(nextSrc);
          return;
        }
        objectUrl = nextSrc.startsWith('blob:') ? nextSrc : '';
        setDisplaySrc(nextSrc);
      } catch {
        if (!cancelled) {
          setDisplaySrc('');
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadImage();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, reloadKey]);

  return (
    <div className='relative overflow-hidden rounded-md bg-bg-1'>
      {loading ? (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-bg-1/80 text-fg-2'>
          <Loader2 className='h-4 w-4 animate-spin' />
        </div>
      ) : null}
      {loadError ? (
        <button
          type='button'
          onClick={() => setReloadKey((key) => key + 1)}
          className='flex h-full min-h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-4 text-12 text-fg-2'
        >
          <RefreshCw className='h-4 w-4' />
          重新加载图片
        </button>
      ) : (
        <img src={displaySrc} alt={alt} className={className} />
      )}
    </div>
  );
}

async function submitMobileAsyncImageGeneration({
  token,
  model,
  prompt,
  referenceImageUrls,
  count,
  resolution,
  onStatus,
}: {
  token: string;
  model: MobileModel;
  prompt: string;
  referenceImageUrls: string[];
  count: number;
  resolution: MobileImageResolution;
  onStatus: (message: string) => void;
}) {
  onStatus('准备提交图片任务');
  const body: Record<string, unknown> = {
    model: model.name,
    prompt,
    size: '1:1',
    n: Math.max(1, Math.min(4, count || DEFAULT_MOBILE_IMAGE_COUNT)),
    response_format: 'url',
    output_format: 'png',
    quality: 'medium',
  };
  if (resolution !== 'auto') {
    body.resolution = resolution;
  }
  const imageUrls = referenceImageUrls.filter(Boolean).slice(0, MAX_ATTACHED_IMAGES);
  if (imageUrls.length > 0) {
    body.image = imageUrls[0];
    body.images = imageUrls;
  }

  const submitResponse = await fetch('/v1/images/async', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!submitResponse.ok) {
    throw new Error(`图片任务提交失败：${await safeReadResponseError(submitResponse)}`);
  }
  const taskId = parseAsyncSubmitResponse(await submitResponse.json());
  onStatus('图片任务已提交，等待生成');

  const startedAt = Date.now();
  const timeoutMs = 18 * 60 * 1000;
  let delayMs = 2500;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(delayMs);
    const response = await fetch(`/v1/images/async/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`图片任务查询失败：${await safeReadResponseError(response)}`);
    }
    const data = (await response.json()) as AsyncImageTaskResponse;
    const status = normalizeAsyncImageStatus(data.status);
    const progress = normalizeAsyncImageProgress(data.progress, status);
    onStatus(asyncImageStatusMessage(status, progress));

    if (status === 'succeeded') {
      if (!data.result) throw new Error('异步图片任务已完成，但结果为空');
      return data.result;
    }
    if (status === 'failed') {
      throw new Error(data.error?.message || '异步图片任务生成失败');
    }
    delayMs = Math.min(6000, Math.round(delayMs * 1.15));
  }
  throw new Error('异步图片任务等待超时，请稍后在历史记录中查看');
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
  action,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
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
        {action ?? (
          <Button size='sm' variant='secondary' className='shrink-0' onClick={() => void refresh()}>
            <RefreshCw className='h-4 w-4' />
          </Button>
        )}
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
        .split(/[,\uFF0C]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, compact ? 2 : 3)
    : [];
  const posterUrl = app.icon_url ? resolveAssetUrl(app.icon_url) : '';
  const [posterFailed, setPosterFailed] = useState(false);

  async function handleUse() {
    try {
      await api.get('/api/user/self');
      const res = await tokenMutation.mutateAsync();
      const key = getSessionKey(res);
      if (!key) throw new Error('missing app token');
      launchApp(app, key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionInvalid();
        return;
      }
      toast.error('应用启动失败，请稍后重试');
    }
  }

  const poster =
    posterUrl && !posterFailed ? (
      <img
        src={posterUrl}
        alt=''
        className='h-full w-full object-cover transition duration-300 group-active:scale-[1.02]'
        onError={() => setPosterFailed(true)}
      />
    ) : (
      <div className='flex h-full w-full items-center justify-center bg-primary/10 text-primary'>
        <ImageIcon className={compact ? 'h-6 w-6' : 'h-9 w-9'} />
      </div>
    );

  return (
    <button
      type='button'
      onClick={() => void handleUse()}
      disabled={tokenMutation.isPending}
      className='group w-full overflow-hidden rounded-lg border border-line bg-bg-0 text-left shadow-sm transition active:scale-[0.99] disabled:opacity-70'
    >
      {!compact ? (
        <div className='relative aspect-[16/9] overflow-hidden bg-bg-2'>
          {poster}
          <div className='absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/35 to-transparent' />
        </div>
      ) : null}
      <div className={cn('flex items-start gap-3 p-3.5', !compact && 'pb-0')}>
        {compact ? (
          <div className='h-16 w-24 shrink-0 overflow-hidden rounded-md bg-bg-2'>{poster}</div>
        ) : null}
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
        <div className='flex flex-wrap gap-1.5 px-3.5 pb-3.5 pt-3'>
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

export function MobileChat({
  immersive = false,
  onExitChatMode,
  desktop = false,
  desktopFullscreenLink = true,
}: {
  immersive?: boolean;
  onExitChatMode?: () => void;
  desktop?: boolean;
  desktopFullscreenLink?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pricing = usePricing();
  const [kind, setKind] = useState<ModelKind>('chat');
  const [selectedModelNames, setSelectedModelNames] = useState<Record<ModelKind, string>>({
    chat: '',
    image: 'gpt-image-2',
  });
  const [input, setInput] = useState('');
  const [messagesByKind, setMessagesByKind] = useState<Record<ModelKind, ChatMessage[]>>({
    chat: [],
    image: [],
  });
  const [loadedConversationKinds, setLoadedConversationKinds] = useState<
    Record<ModelKind, boolean>
  >({
    chat: false,
    image: false,
  });
  const [historyRecordsByKind, setHistoryRecordsByKind] = useState<
    Record<ModelKind, ChatMessage[]>
  >({
    chat: [],
    image: [],
  });
  const [historyOffsets, setHistoryOffsets] = useState<Record<ModelKind, number>>({
    chat: 0,
    image: 0,
  });
  const [historyHasMore, setHistoryHasMore] = useState<Record<ModelKind, boolean>>({
    chat: true,
    image: true,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [imageCount, setImageCount] = useState(DEFAULT_MOBILE_IMAGE_COUNT);
  const [imageResolution, setImageResolution] = useState<MobileImageResolution>(
    DEFAULT_MOBILE_IMAGE_RESOLUTION
  );
  const [runningByKind, setRunningByKind] = useState<Record<ModelKind, boolean>>({
    chat: false,
    image: false,
  });
  const [imageTaskMessage, setImageTaskMessage] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const models = useMemo(() => modelsFromPricing(pricing.data), [pricing.data]);
  const chatModels = models.filter((model) => model.kind === 'chat');
  const imageModels = models.filter((model) => model.kind === 'image');
  const visibleModels = kind === 'chat' ? chatModels : imageModels;
  const selectedModelName = selectedModelNames[kind];
  const preferredModelName = kind === 'image' ? 'gpt-image-2' : 'gpt-5.5';
  const selectedModel =
    visibleModels.find((model) => model.name === selectedModelName) ??
    visibleModels.find((model) => model.name === preferredModelName) ??
    visibleModels[0];
  const messages = messagesByKind[kind];
  const historyRecords = historyRecordsByKind[kind];
  const historyEntries = useMemo(() => buildHistoryEntries(historyRecords), [historyRecords]);
  const running = runningByKind[kind];

  useEffect(() => {
    let cancelled = false;
    async function loadConversation() {
      if (loadedConversationKinds[kind]) return;
      try {
        const res = await api.get<{ items: StoredChatMessage[] }>(
          `/api/app/mobile-chat/messages?kind=${kind}&limit=${CHAT_INITIAL_LIMIT}`
        );
        if (cancelled) return;
        const items = res.data.items ?? [];
        setMessagesByKind((prev) => ({
          ...prev,
          [kind]: items.map(storedMessageToChatMessage),
        }));
        setLoadedConversationKinds((prev) => ({ ...prev, [kind]: true }));
      } catch {
        if (!cancelled) setLoadedConversationKinds((prev) => ({ ...prev, [kind]: true }));
      }
    }
    void loadConversation();
    return () => {
      cancelled = true;
    };
  }, [kind, loadedConversationKinds]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  function clearAttachedImages() {
    setAttachedImages((prev) => {
      prev.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
        previewUrlsRef.current.delete(image.previewUrl);
      });
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachedImage(id: string) {
    setAttachedImages((prev) => {
      const image = prev.find((item) => item.id === id);
      if (image) {
        URL.revokeObjectURL(image.previewUrl);
        previewUrlsRef.current.delete(image.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }

  function onImageFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    if (files.length === 0) return;

    setAttachedImages((prev) => {
      const available = Math.max(0, MAX_ATTACHED_IMAGES - prev.length);
      const nextFiles = files.slice(0, available);
      if (files.length > available) {
        toast.info(`最多上传 ${MAX_ATTACHED_IMAGES} 张参考图`);
      }
      const images = nextFiles.map((file, index) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
        return {
          id: `img-${Date.now()}-${index}`,
          file,
          previewUrl,
        };
      });
      return [...prev, ...images];
    });

    event.target.value = '';
  }

  function setMessagesForKind(
    messageKind: ModelKind,
    nextMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) {
    setMessagesByKind((prev) => ({
      ...prev,
      [messageKind]:
        typeof nextMessages === 'function' ? nextMessages(prev[messageKind]) : nextMessages,
    }));
  }

  function prependHistoryMessagesForKind(messageKind: ModelKind, newMessagesDesc: ChatMessage[]) {
    setHistoryRecordsByKind((prev) => ({
      ...prev,
      [messageKind]: [...newMessagesDesc, ...prev[messageKind]],
    }));
    setHistoryOffsets((prev) => ({
      ...prev,
      [messageKind]: prev[messageKind] + newMessagesDesc.length,
    }));
  }

  async function loadHistoryPage(messageKind: ModelKind, reset = false) {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const offset = reset ? 0 : historyOffsets[messageKind];
      const res = await api.get<{ items: StoredChatMessage[]; has_more?: boolean }>(
        `/api/app/mobile-chat/messages?kind=${messageKind}&order=desc&limit=${HISTORY_PAGE_SIZE}&offset=${offset}`
      );
      const items = (res.data.items ?? []).map(storedMessageToChatMessage);
      setHistoryRecordsByKind((prev) => ({
        ...prev,
        [messageKind]: reset ? items : [...prev[messageKind], ...items],
      }));
      setHistoryOffsets((prev) => ({
        ...prev,
        [messageKind]: offset + items.length,
      }));
      setHistoryHasMore((prev) => ({
        ...prev,
        [messageKind]: Boolean(res.data.has_more),
      }));
    } catch {
      toast.error('历史记录加载失败');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (showHistory) {
      void loadHistoryPage(kind, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, kind]);

  function switchKind(nextKind: ModelKind, keepModelPickerOpen = false) {
    setKind(nextKind);
    if (!keepModelPickerOpen) {
      setModelPickerOpen(false);
    }
    if (nextKind === 'chat') {
      clearAttachedImages();
    }
  }

  function persistMessage(
    message: ChatMessage,
    model: MobileModel,
    messageKind: ModelKind,
    persistImages?: string[]
  ) {
    void api.post('/api/app/mobile-chat/messages', {
      role: message.role,
      kind: messageKind,
      model: model.name,
      model_display_name: model.displayName,
      content: message.content,
      images: persistImages ?? message.images ?? [],
      created_at: currentTimestamp(),
    });
  }

  async function openGeneratedImage(src: string) {
    try {
      const displayUrl = await fetchMobileImageObjectUrl(src);
      window.open(displayUrl, '_blank', 'noopener,noreferrer');
      if (displayUrl.startsWith('blob:')) {
        window.setTimeout(() => URL.revokeObjectURL(displayUrl), 60_000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '图片打开失败';
      toast.error(msg);
    }
  }

  async function startNewChat() {
    if (running) return;

    setMessagesForKind(kind, []);
    setHistoryRecordsByKind((prev) => ({ ...prev, [kind]: [] }));
    setHistoryOffsets((prev) => ({ ...prev, [kind]: 0 }));
    setHistoryHasMore((prev) => ({ ...prev, [kind]: false }));
    setInput('');
    setImageTaskMessage('');
    setModelPickerOpen(false);
    clearAttachedImages();
    try {
      await api.delete(`/api/app/mobile-chat/messages?kind=${kind}`);
      toast.success('已开启新对话');
    } catch {
      toast.error('新对话已开启，但历史清理失败');
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || running || !selectedModel) return;

    const activeKind = kind;
    const activeMessages = messagesByKind[activeKind];
    const activeModel = selectedModel;
    const referenceImages = activeKind === 'image' ? attachedImages : [];
    const userCreatedAt = currentTimestamp();
    const userMessage: ChatMessage = {
      id: createMessageId('u'),
      role: 'user',
      content:
        referenceImages.length > 0 ? `${content}\n\n参考图：${referenceImages.length} 张` : content,
      images: referenceImages.map((image) => image.previewUrl),
      createdAt: userCreatedAt,
    };
    setMessagesForKind(activeKind, (prev) => [...prev, userMessage]);
    setInput('');
    if (referenceImages.length > 0) {
      setAttachedImages([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    setRunningByKind((prev) => ({ ...prev, [activeKind]: true }));

    let pendingAssistantMessageId = '';
    try {
      if (activeKind === 'image' && referenceImages.length > 0) {
        setImageTaskMessage(`正在上传参考图 0/${referenceImages.length}`);
      }
      const referenceImageUrls =
        activeKind === 'image' && referenceImages.length > 0
          ? await uploadMobileReferenceImages(
              referenceImages.slice(0, MAX_ATTACHED_IMAGES),
              (done, total) => {
                setImageTaskMessage(`正在上传参考图 ${done}/${total}`);
              }
            )
          : [];
      persistMessage(userMessage, activeModel, activeKind, referenceImageUrls);
      if (activeKind === 'chat') {
        const reply: ChatMessage = {
          id: createMessageId('a'),
          role: 'assistant',
          content: '',
          createdAt: currentTimestamp(),
        };
        pendingAssistantMessageId = reply.id;
        setMessagesForKind(activeKind, (prev) => [...prev, reply]);
        const streamedText = await submitMobileChatCompletion({
          token: await getMobileChatRelayToken(),
          model: activeModel.name,
          messages: [...activeMessages, userMessage].slice(-8).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          onText: (nextText) => {
            setMessagesForKind(activeKind, (prev) =>
              prev.map((message) =>
                message.id === reply.id ? { ...message, content: nextText } : message
              )
            );
          },
        });
        const finalReply = {
          ...reply,
          content: streamedText || reply.content,
          createdAt: currentTimestamp(),
        };
        setMessagesForKind(activeKind, (prev) =>
          prev.map((message) => (message.id === reply.id ? finalReply : message))
        );
        prependHistoryMessagesForKind(activeKind, [finalReply, userMessage]);
        persistMessage(finalReply, activeModel, activeKind);
        pendingAssistantMessageId = '';
        return;
      }
      const data = await submitMobileAsyncImageGeneration({
        token: await getMobileImageRelayToken(),
        model: activeModel,
        prompt: content,
        referenceImageUrls,
        count: imageCount,
        resolution: imageResolution,
        onStatus: setImageTaskMessage,
      });
      const imageUrls = extractImageUrls(data);
      const reply: ChatMessage = {
        id: createMessageId('a'),
        role: 'assistant',
        content:
          activeKind === 'image'
            ? imageUrls.length > 0
              ? '图片已生成'
              : '图片模型已返回结果，但当前页面没有拿到可展示的图片地址。'
            : extractChatText(data),
        images: imageUrls,
        createdAt: currentTimestamp(),
      };
      setMessagesForKind(activeKind, (prev) => [...prev, reply]);
      prependHistoryMessagesForKind(activeKind, [reply, userMessage]);
      persistMessage(reply, activeModel, activeKind);
    } catch (err) {
      const msg = err instanceof ApiError ? (err.backendMessage ?? err.message) : '对话请求失败';
      toast.error(msg);
      const errorMessage: ChatMessage = {
        id: createMessageId('e'),
        role: 'assistant',
        content: `请求失败：${msg}`,
        createdAt: currentTimestamp(),
      };
      setMessagesForKind(activeKind, (prev) => [
        ...prev.filter((message) => message.id !== pendingAssistantMessageId),
        errorMessage,
      ]);
      prependHistoryMessagesForKind(activeKind, [errorMessage, userMessage]);
      persistMessage(errorMessage, activeModel, activeKind);
    } finally {
      setRunningByKind((prev) => ({ ...prev, [activeKind]: false }));
      if (activeKind === 'image') {
        setImageTaskMessage('');
      }
    }
  }

  return (
    <section
      className={cn(
        desktop
          ? 'flex h-[calc(100vh-104px)] min-h-[620px] flex-col rounded-xl border border-line bg-bg-0 p-5 shadow-sm'
          : immersive
            ? 'flex min-h-[100dvh] flex-col rounded-none border-0 bg-bg-0 p-4 shadow-none'
            : 'rounded-lg border border-line bg-bg-0 p-4 shadow-sm'
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
              <h2 className={cn('truncate font-semibold', desktop ? 'text-20' : 'text-17')}>
                与大模型对话
              </h2>
              {(immersive || desktop) && selectedModel ? (
                <p className='truncate text-11 text-fg-2'>{selectedModel.displayName}</p>
              ) : null}
            </div>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {pricing.isPending ? <Loader2 className='h-4 w-4 animate-spin text-fg-2' /> : null}
          {desktop ? (
            <>
              <button
                type='button'
                onClick={() => void startNewChat()}
                disabled={running}
                className='inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-bg-1 px-3 text-12 font-medium text-fg-1 disabled:opacity-50'
              >
                <Plus className='h-4 w-4' />
                新对话
              </button>
              <button
                type='button'
                onClick={() => setShowHistory(true)}
                className='inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-bg-1 px-3 text-12 font-medium text-fg-1'
              >
                <History className='h-4 w-4' />
                记录
              </button>
              {desktopFullscreenLink ? (
                <Link
                  to='/apps/chat'
                  className='inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-bg-1 px-3 text-12 font-medium text-fg-1'
                >
                  <ArrowRight className='h-4 w-4' />
                  全屏
                </Link>
              ) : null}
            </>
          ) : immersive ? (
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
          ) : (
            <>
              <button
                type='button'
                onClick={() => setShowHistory(true)}
                className='flex h-9 w-9 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
                aria-label='查看历史记录'
              >
                <History className='h-4 w-4' />
              </button>
              {!desktop ? (
                <Link
                  to='/m/chat'
                  className='flex h-9 w-9 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
                  aria-label='打开全屏对话'
                >
                  <ArrowRight className='h-4 w-4' />
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className='mt-3 grid grid-cols-2 gap-1 rounded-md bg-bg-1 p-1'>
        {(
          [
            { value: 'chat', label: MODEL_KIND_LABELS.chat, icon: Bot, count: chatModels.length },
            {
              value: 'image',
              label: MODEL_KIND_LABELS.image,
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
              onClick={() => switchKind(item.value)}
              className={cn(
                'flex h-9 items-center justify-center gap-1.5 rounded px-2 text-12 font-medium transition',
                kind === item.value ? 'bg-bg-0 text-fg-0 shadow-sm' : 'text-fg-2'
              )}
            >
              <Icon className='h-3.5 w-3.5' />
              <span>{item.label}</span>
              <span className='text-11 text-fg-3'>{item.count}</span>
            </button>
          );
        })}
      </div>

      <>
        {messages.length > 0 || running ? (
          <div
            className={cn(
              'mt-4 space-y-3 overflow-y-auto rounded-md bg-bg-1 p-3',
              desktop ? 'min-h-0 flex-1' : immersive ? 'min-h-[48vh] flex-1' : 'max-h-72'
            )}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[86%] rounded-lg px-3 py-2 text-13 leading-6',
                    message.role === 'user'
                      ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                      : 'border border-line bg-bg-0 text-fg-0'
                  )}
                >
                  {message.role === 'assistant' ? (
                    <MarkdownContent
                      content={message.content}
                      className='prose prose-chat max-w-none text-13 leading-6'
                    />
                  ) : (
                    <div>{message.content}</div>
                  )}
                  {message.images?.length ? (
                    <div className='mt-2 grid gap-2'>
                      {message.images.map((src) => (
                        <MobileGeneratedImage
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
                  {kind === 'image' ? imageTaskMessage || '生成中' : '思考中'}
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
                <div className='mb-2 grid grid-cols-2 gap-1 rounded-md bg-bg-1 p-1'>
                  {(
                    [
                      { value: 'chat', label: MODEL_KIND_LABELS.chat, count: chatModels.length },
                      { value: 'image', label: MODEL_KIND_LABELS.image, count: imageModels.length },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.value}
                      type='button'
                      onClick={() => switchKind(item.value, true)}
                      className={cn(
                        'flex h-8 items-center justify-center gap-1.5 rounded px-2 text-12 font-medium transition',
                        kind === item.value ? 'bg-bg-0 text-fg-0 shadow-sm' : 'text-fg-2'
                      )}
                    >
                      <span>{item.label}</span>
                      <span className='text-11 text-fg-3'>{item.count}</span>
                    </button>
                  ))}
                </div>
                <div key={kind} className='max-h-44 space-y-1 overflow-y-auto'>
                  {visibleModels.length > 0 ? (
                    visibleModels.slice(0, 50).map((model) => (
                      <button
                        key={model.name}
                        type='button'
                        onClick={() => {
                          setSelectedModelNames((prev) => ({ ...prev, [kind]: model.name }));
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
                    ))
                  ) : (
                    <div className='rounded-md bg-bg-1 px-3 py-4 text-center text-12 text-fg-2'>
                      暂无可用{MODEL_KIND_LABELS[kind]}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className='mt-2 px-1 text-11 leading-5 text-fg-3'>
          对话记录和图片仅保存一周，请及时保存重要内容。
        </p>

        <div className='mt-3 space-y-2'>
          {kind === 'image' ? (
            <div className='rounded-md border border-line bg-bg-1 px-2 py-1.5'>
              <div className='flex items-center justify-between gap-2'>
                <div className='flex min-w-0 items-center gap-2'>
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={running || attachedImages.length >= MAX_ATTACHED_IMAGES}
                    className='inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line bg-bg-0 px-2.5 text-12 font-medium text-fg-1 disabled:opacity-50'
                  >
                    <Upload className='h-3.5 w-3.5' />
                    参考图
                    {attachedImages.length > 0 ? (
                      <span className='text-11 text-fg-3'>{attachedImages.length}</span>
                    ) : null}
                  </button>
                  {attachedImages.length > 0 ? (
                    <button
                      type='button'
                      onClick={clearAttachedImages}
                      disabled={running}
                      className='inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-12 font-medium text-fg-2 disabled:opacity-50'
                    >
                      清空
                    </button>
                  ) : null}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      disabled={running}
                      className='inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-line bg-bg-0 px-2.5 text-12 font-medium text-fg-1 disabled:opacity-50'
                    >
                      {imageCount}张 ·{' '}
                      {
                        MOBILE_IMAGE_RESOLUTION_OPTIONS.find(
                          (option) => option.value === imageResolution
                        )?.label
                      }
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    <div className='px-2 py-1.5'>
                      <div className='mb-1 text-11 font-medium text-fg-2'>数量</div>
                      <div className='grid grid-cols-3 gap-1'>
                        {MOBILE_IMAGE_COUNT_OPTIONS.map((count) => (
                          <button
                            key={count}
                            type='button'
                            onClick={() => setImageCount(count)}
                            className={cn(
                              'h-8 rounded-md text-12 font-medium transition',
                              imageCount === count
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-bg-1 text-fg-2 hover:bg-bg-2'
                            )}
                          >
                            {count}张
                          </button>
                        ))}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <div className='px-2 py-1.5'>
                      <div className='mb-1 text-11 font-medium text-fg-2'>分辨率</div>
                      <div className='grid grid-cols-2 gap-1'>
                        {MOBILE_IMAGE_RESOLUTION_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type='button'
                            onClick={() => setImageResolution(option.value)}
                            className={cn(
                              'h-8 rounded-md text-12 font-medium transition',
                              imageResolution === option.value
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-bg-1 text-fg-2 hover:bg-bg-2'
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/*'
                multiple
                className='hidden'
                onChange={onImageFilesChange}
              />
              {attachedImages.length > 0 ? (
                <div className='mt-2 grid grid-cols-4 gap-2'>
                  {attachedImages.map((image) => (
                    <div
                      key={image.id}
                      className='relative aspect-square overflow-hidden rounded-md border border-line bg-bg-0'
                    >
                      <img src={image.previewUrl} alt='' className='h-full w-full object-cover' />
                      <button
                        type='button'
                        onClick={() => removeAttachedImage(image.id)}
                        disabled={running}
                        className='absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-bg-0/90 text-fg-1 shadow-sm disabled:opacity-50'
                        aria-label='移除参考图'
                      >
                        <X className='h-3.5 w-3.5' />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              kind === 'image'
                ? attachedImages.length > 0
                  ? '描述怎么改图：保留主体，改成赛博朋克海报风格...'
                  : '描述图片：一张适合小程序分享卡片的海报...'
                : '问问模型：帮我写一段小程序介绍...'
            }
            className='min-h-20 resize-none'
            rows={desktop ? 4 : undefined}
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
            <DialogTitle className='text-16'>
              {kind === 'image' ? '图片记录' : '对话记录'}
            </DialogTitle>
            <p className='text-12 font-normal text-fg-2'>记录仅保存一周</p>
          </DialogHeader>
          <div className='max-h-[68vh] space-y-3 overflow-y-auto p-4'>
            {historyLoading && historyEntries.length === 0 ? (
              <div className='flex items-center justify-center gap-2 rounded-md border border-line bg-bg-1 p-5 text-center text-13 text-fg-2'>
                <Loader2 className='h-4 w-4 animate-spin' />
                加载历史记录
              </div>
            ) : historyEntries.length === 0 ? (
              <div className='rounded-md border border-line bg-bg-1 p-5 text-center text-13 text-fg-2'>
                {kind === 'image' ? '暂无图片记录' : '暂无对话记录'}
              </div>
            ) : (
              <>
                {historyEntries.map((entry) => (
                  <div key={entry.id} className='rounded-md border border-line bg-bg-1 p-3'>
                    {entry.user ? (
                      <div>
                        <div className='mb-1 text-11 font-medium text-fg-2'>我</div>
                        <p className='line-clamp-4 whitespace-pre-wrap text-13 leading-6 text-fg-0'>
                          {entry.user.content}
                        </p>
                        {entry.user.images?.length ? (
                          <div className='mt-2 grid grid-cols-4 gap-2'>
                            {entry.user.images.slice(0, 4).map((src, index) => (
                              <button
                                key={`${src}-${index}`}
                                type='button'
                                onClick={() => void openGeneratedImage(src)}
                                className='aspect-square overflow-hidden rounded-md border border-line bg-bg-0'
                                aria-label={`查看参考图 ${index + 1}`}
                              >
                                <MobileGeneratedImage
                                  src={src}
                                  alt=''
                                  className='h-full w-full object-cover'
                                />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {entry.assistant ? (
                      <div className={cn(entry.user ? 'mt-3 border-t border-line pt-3' : '')}>
                        <div className='mb-1 text-11 font-medium text-fg-2'>AI</div>
                        <p className='line-clamp-4 whitespace-pre-wrap text-13 leading-6 text-fg-0'>
                          {entry.assistant.content || '图片结果'}
                        </p>
                        {entry.assistant.images?.length ? (
                          <div className='mt-3 space-y-2'>
                            <div className='grid grid-cols-3 gap-2'>
                              {entry.assistant.images.slice(0, 3).map((src, index) => (
                                <button
                                  key={src}
                                  type='button'
                                  onClick={() => void openGeneratedImage(src)}
                                  className='aspect-square overflow-hidden rounded-md border border-line bg-bg-0'
                                  aria-label={`查看图片 ${index + 1}`}
                                >
                                  <MobileGeneratedImage
                                    src={src}
                                    alt=''
                                    className='h-full w-full object-cover'
                                  />
                                </button>
                              ))}
                            </div>
                            <div className='flex flex-wrap gap-2'>
                              {entry.assistant.images.map((src, index) => (
                                <button
                                  key={`${src}-${index}`}
                                  type='button'
                                  onClick={() => void openGeneratedImage(src)}
                                  className='inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-bg-0 px-2.5 text-12 font-medium text-fg-1'
                                >
                                  <ExternalLink className='h-3.5 w-3.5' />
                                  查看图片 {index + 1}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {historyHasMore[kind] ? (
                  <button
                    type='button'
                    onClick={() => void loadHistoryPage(kind)}
                    disabled={historyLoading}
                    className='flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-bg-0 text-13 font-medium text-fg-1 disabled:opacity-60'
                  >
                    {historyLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                    加载更多
                  </button>
                ) : null}
              </>
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
  const marketplaceApps = filterMarketplaceApps(appsQuery.data ?? []);
  const apps = limit ? marketplaceApps.slice(0, limit) : marketplaceApps;

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
        <Link to='/m/chat'>开始对话</Link>
      </Button>
    </section>
  );
}

export function MobileHomePage() {
  const { user } = useAuth();
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-1 pb-10 text-fg-0'>
      <MobileHeader
        title='AI 工作台'
        subtitle='对话、应用和积分充值'
        action={
          <Link
            to='/m/chat'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
            aria-label='打开 AI 对话'
          >
            <MessageCircle className='h-4 w-4' />
          </Link>
        }
      />
      <div className='mx-auto max-w-md space-y-4 px-4 py-4'>
        <PointsCard compact />
        <MobileChat />
        <RecommendedApps limit={3} showMore />
      </div>
    </main>
  );
}

export function MobileChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-0 text-fg-0'>
      <MobileChat immersive onExitChatMode={() => navigate('/m')} />
    </main>
  );
}

export function MobileAppsPage() {
  const { user } = useAuth();
  if (!user) return <LoginRequired />;
  return (
    <main className='min-h-screen bg-bg-1 pb-10 text-fg-0'>
      <MobileHeader
        title='AI 应用'
        subtitle='选择应用后直接启动'
        backTo='/m'
        action={
          <Link
            to='/m/chat'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-bg-1 text-fg-1'
            aria-label='打开 AI 对话'
          >
            <MessageCircle className='h-4 w-4' />
          </Link>
        }
      />
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
  if (route === 'chat') return <MobileChatPage />;
  if (route === 'topup') return <MobileTopupPage />;
  return <MobileHomePage />;
}
