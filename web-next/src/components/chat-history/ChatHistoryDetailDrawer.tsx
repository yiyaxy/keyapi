import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useChatHistoryDetail,
  type ChatHistoryEnvelope,
  type EnvelopePayload,
} from '@/hooks/useChatHistory';

export type ChatHistoryDetailDrawerProps = {
  requestId: string | null;
  onOpenChange: (open: boolean) => void;
};

export function ChatHistoryDetailDrawer({
  requestId,
  onOpenChange,
}: ChatHistoryDetailDrawerProps) {
  const query = useChatHistoryDetail(requestId);

  return (
    <Dialog open={Boolean(requestId)} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-4xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>对话记录详情</DialogTitle>
        </DialogHeader>
        {query.isPending ? (
          <div className='mt-4 space-y-2'>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className='h-6 w-full' />
            ))}
          </div>
        ) : query.isError ? (
          <div className='mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-13 text-red-700'>
            加载失败：{(query.error as Error).message}
          </div>
        ) : query.data ? (
          <DetailBody envelope={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ envelope }: { envelope: ChatHistoryEnvelope }) {
  const reqMessages = extractChatMessages(envelope.request);
  const respText = extractResponseText(envelope.response, envelope.is_stream);

  return (
    <div className='mt-4 space-y-4'>
      <MetaBlock envelope={envelope} />
      {reqMessages.length > 0 ? (
        <Section title={`对话 (${reqMessages.length} turns)`}>
          <ConversationView messages={reqMessages} assistantReply={respText} />
        </Section>
      ) : (
        <Section title='请求体'>
          <RawPayloadView payload={envelope.request} />
        </Section>
      )}
      <Section title='响应体'>
        <RawPayloadView payload={envelope.response} />
        {envelope.response_truncated_at_bytes ? (
          <div className='mt-2 text-12 text-orange-600'>
            响应体超过缓冲上限，已在 {envelope.response_truncated_at_bytes} 字节处截断
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function MetaBlock({ envelope }: { envelope: ChatHistoryEnvelope }) {
  return (
    <div className='grid grid-cols-2 gap-2 rounded-md border border-line bg-bg-1 p-3 text-12'>
      <Meta label='request_id' value={envelope.request_id} mono />
      <Meta label='captured_at' value={envelope.captured_at} mono />
      <Meta label='user' value={`${envelope.username ?? '-'} (#${envelope.user_id})`} />
      <Meta label='tenant' value={String(envelope.tenant_id ?? 0)} />
      <Meta label='model' value={envelope.model ?? '-'} />
      <Meta label='status' value={String(envelope.status_code)} />
      <Meta label='method/path' value={`${envelope.method} ${envelope.path}`} mono />
      <Meta label='is_stream' value={envelope.is_stream ? 'yes' : 'no'} />
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className='flex gap-2'>
      <span className='shrink-0 text-fg-3'>{label}:</span>
      <span className={mono ? 'break-all font-mono text-fg-1' : 'text-fg-1'}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className='mb-2 text-13 font-medium text-fg-1'>{title}</div>
      <div className='rounded-md border border-line bg-bg-1 p-3'>{children}</div>
    </div>
  );
}

// --- Conversation view ---------------------------------------------------

type ChatMessage = {
  role: string;
  text: string;
  toolCalls?: { name: string; args: string }[];
};

function ConversationView({
  messages,
  assistantReply,
}: {
  messages: ChatMessage[];
  assistantReply: string | null;
}) {
  return (
    <div className='space-y-3'>
      {messages.map((m, i) => (
        <Bubble key={i} role={m.role}>
          {m.text && <div className='whitespace-pre-wrap text-13'>{m.text}</div>}
          {m.toolCalls?.map((tc, j) => (
            <div
              key={j}
              className='mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-12'
            >
              <div className='font-medium text-amber-900'>↳ tool: {tc.name}</div>
              <pre className='mt-1 overflow-x-auto text-11 text-amber-800'>{tc.args}</pre>
            </div>
          ))}
        </Bubble>
      ))}
      {assistantReply && (
        <Bubble role='assistant_reply'>
          <div className='whitespace-pre-wrap text-13'>{assistantReply}</div>
        </Bubble>
      )}
    </div>
  );
}

function Bubble({ role, children }: { role: string; children: React.ReactNode }) {
  const tone = roleTone(role);
  return (
    <div
      className={`rounded-md border p-3 ${tone.bg} ${tone.border}`}
    >
      <div className={`mb-1 text-11 font-medium uppercase ${tone.label}`}>{role}</div>
      {children}
    </div>
  );
}

function roleTone(role: string) {
  switch (role) {
    case 'system':
      return { bg: 'bg-bg-2', border: 'border-line', label: 'text-fg-3' };
    case 'user':
      return { bg: 'bg-blue-50', border: 'border-blue-200', label: 'text-blue-700' };
    case 'assistant':
    case 'assistant_reply':
      return { bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'text-emerald-700' };
    case 'tool':
      return { bg: 'bg-amber-50', border: 'border-amber-200', label: 'text-amber-800' };
    default:
      return { bg: 'bg-bg-1', border: 'border-line', label: 'text-fg-2' };
  }
}

// --- Raw payload view ----------------------------------------------------

function RawPayloadView({ payload }: { payload: EnvelopePayload }) {
  if (payload.bytes === 0) {
    return <div className='text-12 text-fg-3'>(empty)</div>;
  }
  if (payload.body !== undefined) {
    return (
      <pre className='overflow-x-auto text-12 text-fg-1'>
        {JSON.stringify(payload.body, null, 2)}
      </pre>
    );
  }
  if (payload.body_text !== undefined) {
    return <pre className='overflow-x-auto text-12 text-fg-1'>{payload.body_text}</pre>;
  }
  if (payload.body_base64) {
    return (
      <div className='text-12 text-fg-2'>
        Binary content ({formatBytes(payload.bytes)}, content-type:{' '}
        <code>{payload.content_type}</code>) — base64 in storage, not rendered here.
      </div>
    );
  }
  return <div className='text-12 text-fg-3'>(no body captured)</div>;
}

// --- Extraction helpers --------------------------------------------------

function extractChatMessages(payload: EnvelopePayload): ChatMessage[] {
  // We only know how to render the OpenAI-style {messages: [{role, content}]}
  // shape today. Anthropic Messages API is similar; both should fall through
  // here. Anything weirder gets the raw view instead.
  const body = payload.body as { messages?: unknown[] } | undefined;
  if (!body || !Array.isArray(body.messages)) return [];
  return body.messages
    .map((raw): ChatMessage | null => {
      if (!raw || typeof raw !== 'object') return null;
      const m = raw as {
        role?: string;
        content?: unknown;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
      const role = m.role ?? 'unknown';
      const text = stringifyContent(m.content);
      const toolCalls =
        m.tool_calls?.map((tc) => ({
          name: tc.function?.name ?? 'unknown',
          args: tc.function?.arguments ?? '',
        })) ?? undefined;
      return { role, text, toolCalls };
    })
    .filter((m): m is ChatMessage => m !== null);
}

function stringifyContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    // OpenAI multimodal: array of {type, text, image_url, ...}
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as { type?: string; text?: string; image_url?: { url?: string } };
          if (p.type === 'text' && p.text) return p.text;
          if (p.type === 'image_url') return `[image: ${p.image_url?.url ?? '?'}]`;
          return `[${p.type ?? 'unknown'}]`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (c == null) return '';
  return JSON.stringify(c);
}

function extractResponseText(
  payload: EnvelopePayload,
  isStream: boolean,
): string | null {
  if (isStream && payload.body_text) {
    // SSE: parse out delta.content from each "data: {...}" line and join.
    return parseSSEContent(payload.body_text);
  }
  if (payload.body && typeof payload.body === 'object') {
    const choices = (payload.body as { choices?: Array<{ message?: { content?: unknown } }> })
      .choices;
    const first = choices?.[0]?.message?.content;
    if (first !== undefined) return stringifyContent(first);
  }
  return null;
}

function parseSSEContent(raw: string): string {
  const lines = raw.split('\n');
  let out = '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]' || payload === '') continue;
    try {
      const obj = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = obj.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') out += delta;
    } catch {
      // skip non-JSON SSE payloads
    }
  }
  return out;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
