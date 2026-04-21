import { Copy, Search } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Channel } from '@/hooks/useChannels';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 200;
const AUTO_ENDPOINT = '__auto';

const ENDPOINT_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: AUTO_ENDPOINT, labelKey: 'test.endpoint.auto' },
  { value: 'openai', labelKey: 'test.endpoint.openai' },
  { value: 'openai-response', labelKey: 'test.endpoint.openai_response' },
  { value: 'openai-response-compact', labelKey: 'test.endpoint.openai_response_compact' },
  { value: 'anthropic', labelKey: 'test.endpoint.anthropic' },
  { value: 'gemini', labelKey: 'test.endpoint.gemini' },
  { value: 'jina-rerank', labelKey: 'test.endpoint.jina_rerank' },
  { value: 'image-generation', labelKey: 'test.endpoint.image_generation' },
  { value: 'embeddings', labelKey: 'test.endpoint.embeddings' },
];

const NO_STREAM_ENDPOINTS = new Set([
  'embeddings',
  'image-generation',
  'jina-rerank',
  'openai-response-compact',
]);

type ModelTestResult = {
  success: boolean;
  message?: string;
  timeSec: number;
};

// Calls /api/channel/test/:id. On success=false the response interceptor
// throws ApiError — we catch and render it as a failed result so the
// user can still see per-model errors in the table.
async function runChannelTest(
  channelId: number,
  model: string,
  endpointType: string,
  stream: boolean
): Promise<ModelTestResult> {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (endpointType) params.set('endpoint_type', endpointType);
  if (stream) params.set('stream', 'true');
  const qs = params.toString();
  const url = `/api/channel/test/${channelId}${qs ? `?${qs}` : ''}`;
  try {
    const res = await api.get<{ success?: boolean; message?: string; time?: number }>(url);
    const body = res.data;
    return {
      success: body?.success !== false,
      message: body?.message,
      timeSec: typeof body?.time === 'number' ? body.time : 0,
    };
  } catch (e) {
    if (e instanceof ApiError) {
      return { success: false, message: e.backendMessage ?? e.message, timeSec: 0 };
    }
    return { success: false, message: (e as Error).message, timeSec: 0 };
  }
}

function splitModels(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ChannelTestDialog({
  channel,
  onOpenChange,
  onAfterTest,
}: {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onAfterTest?: () => void;
}) {
  const open = channel !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent className='flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl'>
        {channel ? (
          <TestDialogBody
            key={channel.id}
            channel={channel}
            onClose={() => onOpenChange(false)}
            onAfterTest={onAfterTest}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TestDialogBody({
  channel,
  onClose,
  onAfterTest,
}: {
  channel: Channel;
  onClose: () => void;
  onAfterTest?: () => void;
}) {
  const { t } = useTranslation('channels');

  const [endpointType, setEndpointType] = useState<string>(AUTO_ENDPOINT);
  const [stream, setStream] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());
  const [isBatch, setIsBatch] = useState(false);
  const stopRef = useRef(false);
  const hasResultsRef = useRef(false);

  const allModels = useMemo(() => splitModels(channel.models), [channel.models]);
  const filtered = useMemo(
    () => allModels.filter((m) => m.toLowerCase().includes(keyword.toLowerCase())),
    [allModels, keyword]
  );
  const total = filtered.length;
  const pagedModels = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const endpointValue = endpointType === AUTO_ENDPOINT ? '' : endpointType;
  const streamDisabled = NO_STREAM_ENDPOINTS.has(endpointValue);

  const handleEndpointChange = (next: string) => {
    setEndpointType(next);
    const ep = next === AUTO_ENDPOINT ? '' : next;
    if (NO_STREAM_ENDPOINTS.has(ep) && stream) setStream(false);
  };

  const runSingle = async (model: string): Promise<ModelTestResult | undefined> => {
    setTestingModels((prev) => {
      const next = new Set(prev);
      next.add(model);
      return next;
    });
    const r = await runChannelTest(channel.id, model, endpointValue, stream);
    hasResultsRef.current = true;
    setResults((prev) => ({ ...prev, [model]: r }));
    setTestingModels((prev) => {
      const next = new Set(prev);
      next.delete(model);
      return next;
    });
    return r;
  };

  const runBatch = async () => {
    if (filtered.length === 0) {
      toast.error(t('test.batch.no_match'));
      return;
    }
    setIsBatch(true);
    stopRef.current = false;
    // Clear prior results for the filtered set so progress is visible.
    setResults((prev) => {
      const next = { ...prev };
      filtered.forEach((m) => {
        delete next[m];
      });
      return next;
    });
    toast.info(t('test.batch.start', { count: filtered.length }));
    try {
      for (let i = 0; i < filtered.length; i += CONCURRENCY) {
        if (stopRef.current) break;
        const batch = filtered.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((m) => runSingle(m)));
        if (stopRef.current) break;
        if (i + CONCURRENCY < filtered.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }
      if (stopRef.current) toast.info(t('test.batch.stopped'));
      else toast.success(t('test.batch.done'));
    } finally {
      setIsBatch(false);
      stopRef.current = false;
    }
  };

  const handleCopy = async () => {
    if (selected.size === 0) {
      toast.error(t('test.copy.empty'));
      return;
    }
    const text = Array.from(selected).join(',');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('test.copy.ok', { count: selected.size }));
    } catch {
      toast.error(t('test.copy.fail'));
    }
  };

  const handleSelectSuccess = () => {
    const successes = filtered.filter((m) => results[m]?.success);
    if (successes.length === 0) {
      toast.info(t('test.select_success.empty'));
      return;
    }
    setSelected(new Set(successes));
  };

  const toggleSelect = (model: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const allOnPageSelected = pagedModels.length > 0 && pagedModels.every((m) => selected.has(m));
  const togglePageSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pagedModels.forEach((m) => next.delete(m));
      else pagedModels.forEach((m) => next.add(m));
      return next;
    });
  };

  const handleClose = () => {
    if (isBatch) stopRef.current = true;
    onClose();
    if (hasResultsRef.current) onAfterTest?.();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('test.dialog.title', { name: channel.name || `#${channel.id}` })}
        </DialogTitle>
        <div className='text-12 text-fg-2'>
          {t('test.dialog.count', { count: allModels.length })}
        </div>
      </DialogHeader>

      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <Label className='shrink-0 text-13'>{t('test.endpoint.label')}</Label>
            <Select value={endpointType} onValueChange={handleEndpointChange}>
              <SelectTrigger className='flex-1'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENDPOINT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center gap-2'>
            <Label className='text-13'>{t('test.stream.label')}</Label>
            <Switch checked={stream} onCheckedChange={setStream} disabled={streamDisabled} />
          </div>
        </div>

        <InlineBanner level='info' message={t('test.info_banner')} />

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative flex-1'>
            <Search
              className='pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-2'
              strokeWidth={1.5}
            />
            <Input
              placeholder={t('test.search_placeholder')}
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              className='pl-8'
            />
          </div>
          <div className='flex items-center justify-end gap-2'>
            <Button variant='outline' size='sm' onClick={handleCopy}>
              <Copy className='size-3.5' />
              {t('test.copy_selected')}
            </Button>
            <Button variant='ghost' size='sm' onClick={handleSelectSuccess}>
              {t('test.select_success')}
            </Button>
          </div>
        </div>

        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full border-collapse tabular-nums'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='w-10 px-3 py-2'>
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={togglePageSelectAll}
                    aria-label='select page'
                  />
                </th>
                <th className='px-3 py-2 font-medium'>{t('test.col.model')}</th>
                <th className='px-3 py-2 font-medium'>{t('test.col.status')}</th>
                <th className='px-3 py-2' />
              </tr>
            </thead>
            <tbody>
              {pagedModels.length === 0 ? (
                <tr>
                  <td colSpan={4} className='px-3 py-6 text-center text-13 text-fg-2'>
                    {t('test.batch.no_match')}
                  </td>
                </tr>
              ) : (
                pagedModels.map((m) => {
                  const res = results[m];
                  const isTesting = testingModels.has(m);
                  return (
                    <tr key={m} className='border-b border-line text-13 hover:bg-bg-1'>
                      <td className='px-3 py-2'>
                        <Checkbox
                          checked={selected.has(m)}
                          onCheckedChange={() => toggleSelect(m)}
                          aria-label={`select ${m}`}
                        />
                      </td>
                      <td className='px-3 py-2 font-mono text-12'>{m}</td>
                      <td className='px-3 py-2'>
                        <StatusCell
                          isTesting={isTesting}
                          result={res}
                          labels={{
                            testing: t('test.status.testing'),
                            notStarted: t('test.status.not_started'),
                            success: t('test.status.success'),
                            failure: t('test.status.failure'),
                            latency: (seconds) => t('test.result.latency', { seconds }),
                          }}
                        />
                      </td>
                      <td className='px-3 py-2 text-right'>
                        <Button
                          variant='ghost'
                          size='sm'
                          disabled={isTesting || isBatch}
                          onClick={() => {
                            void runSingle(m);
                          }}
                        >
                          {t('test.action.test')}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <LogsPagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        )}
      </div>

      <DialogFooter className='sm:justify-end'>
        {isBatch ? (
          <Button
            variant='destructive'
            onClick={() => {
              stopRef.current = true;
            }}
          >
            {t('test.action.stop')}
          </Button>
        ) : (
          <Button variant='ghost' onClick={handleClose}>
            {t('test.action.cancel')}
          </Button>
        )}
        <Button onClick={() => void runBatch()} disabled={isBatch || total === 0}>
          {t('test.action.batch', { count: total })}
        </Button>
      </DialogFooter>
    </>
  );
}

function StatusCell({
  isTesting,
  result,
  labels,
}: {
  isTesting: boolean;
  result: ModelTestResult | undefined;
  labels: {
    testing: string;
    notStarted: string;
    success: string;
    failure: string;
    latency: (seconds: string) => string;
  };
}) {
  if (isTesting) return <StatusTag tone='info'>{labels.testing}</StatusTag>;
  if (!result) return <StatusTag tone='muted'>{labels.notStarted}</StatusTag>;
  if (result.success) {
    return (
      <div className='flex items-center gap-2'>
        <StatusTag tone='success'>{labels.success}</StatusTag>
        <span className='text-12 text-fg-2'>{labels.latency(result.timeSec.toFixed(2))}</span>
      </div>
    );
  }
  return (
    <div className='flex items-center gap-2'>
      <StatusTag tone='danger'>{labels.failure}</StatusTag>
      <span className='max-w-[260px] truncate text-12 text-fg-2' title={result.message ?? ''}>
        {result.message ?? ''}
      </span>
    </div>
  );
}

function StatusTag({
  tone,
  children,
}: {
  tone: 'info' | 'muted' | 'success' | 'danger';
  children: ReactNode;
}) {
  const cls = {
    info: 'bg-info-soft text-fg-0',
    muted: 'bg-bg-2 text-fg-2',
    success: 'bg-success-soft text-fg-0',
    danger: 'bg-danger-soft text-fg-0',
  }[tone];
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-11 font-medium', cls)}>
      {children}
    </span>
  );
}
