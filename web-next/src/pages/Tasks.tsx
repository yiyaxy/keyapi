import { Copy, ExternalLink, Eye, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { useMyTasks, type AsyncTask } from '@/hooks/useTasks';
import { fmtDateSec, fmtDisplay } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;
const ALL = '__all';
const DETAIL_JSON_LIMIT = 20_000;

type TaskFilters = {
  platform: string;
  status: string;
  task_id: string;
  action: string;
};

const EMPTY_FILTERS: TaskFilters = {
  platform: ALL,
  status: ALL,
  task_id: '',
  action: '',
};

const PLATFORM_LABELS: Record<string, string> = {
  suno: 'Suno',
  mj: 'Midjourney',
  '1': 'OpenAI',
  '17': 'Ali',
  '24': 'Gemini',
  '35': 'MiniMax',
  '41': 'Vertex AI',
  '45': 'VolcEngine',
  '50': 'Kling',
  '51': 'Jimeng',
  '52': 'Vidu',
  '54': 'Doubao Video',
  '55': 'Sora',
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? (platform || '-');
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'SUCCESS':
      return 'default';
    case 'FAILURE':
      return 'destructive';
    case 'SUBMITTED':
    case 'QUEUED':
    case 'IN_PROGRESS':
      return 'secondary';
    default:
      return 'outline';
  }
}

function progressNumber(progress: string): number {
  const match = progress.match(/\d+/);
  const value = match ? Number(match[0]) : 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function taskModel(task: AsyncTask): string {
  return task.properties?.origin_model_name || task.properties?.upstream_model_name || '-';
}

function taskInput(task: AsyncTask): string {
  return task.properties?.input || '';
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length > DETAIL_JSON_LIMIT) {
      return `${text.slice(0, DETAIL_JSON_LIMIT)}\n...`;
    }
    return text;
  } catch {
    return String(value);
  }
}

async function copyText(value: string, message: string) {
  await navigator.clipboard.writeText(value);
  toast.success(message);
}

function TaskDetailDialog({
  task,
  onOpenChange,
}: {
  task: AsyncTask | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('tasks');
  if (!task) return null;

  const detail = {
    task_id: task.task_id,
    platform: task.platform,
    action: task.action,
    status: task.status,
    progress: task.progress,
    model: taskModel(task),
    result_url: task.result_url,
    fail_reason: task.fail_reason,
    properties: task.properties,
    data: task.data,
  };

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[86vh] max-w-[min(92vw,840px)] overflow-hidden'>
        <DialogTitle>{t('detail.title')}</DialogTitle>
        <DialogDescription>{task.task_id}</DialogDescription>
        <div className='grid gap-3 overflow-auto pr-1'>
          <div className='grid gap-2 md:grid-cols-3'>
            <InfoBlock label={t('col.platform')} value={platformLabel(task.platform)} />
            <InfoBlock label={t('col.status')} value={t(`status.${task.status}`, task.status)} />
            <InfoBlock label={t('col.model')} value={taskModel(task)} />
          </div>
          {task.result_url ? (
            <Button asChild variant='outline' className='w-fit'>
              <a href={task.result_url} target='_blank' rel='noopener noreferrer'>
                <ExternalLink className='size-4' />
                {t('action.open_result')}
              </a>
            </Button>
          ) : null}
          <pre className='max-h-[460px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg-0 p-4 font-mono text-12 leading-5 text-fg-0'>
            {formatJson(detail)}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border border-line bg-bg-0 p-3'>
      <div className='text-12 text-fg-2'>{label}</div>
      <div className='mt-1 truncate text-13 font-medium text-fg-0'>{value}</div>
    </div>
  );
}

function TaskFiltersBar({
  value,
  onChange,
}: {
  value: TaskFilters;
  onChange: (value: TaskFilters) => void;
}) {
  const { t } = useTranslation('tasks');
  const [draft, setDraft] = useState<TaskFilters>(value);

  return (
    <div className='grid gap-3 rounded-md border border-line bg-bg-1 p-4 lg:grid-cols-[150px_170px_minmax(160px,1fr)_minmax(140px,1fr)_auto]'>
      <div className='space-y-1.5'>
        <Label>{t('filter.platform')}</Label>
        <Select
          value={draft.platform}
          onValueChange={(platform) => setDraft((d) => ({ ...d, platform }))}
        >
          <SelectTrigger className='bg-bg-0'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filter.all')}</SelectItem>
            <SelectItem value='24'>Gemini</SelectItem>
            <SelectItem value='41'>Vertex AI</SelectItem>
            <SelectItem value='55'>Sora</SelectItem>
            <SelectItem value='50'>Kling</SelectItem>
            <SelectItem value='51'>Jimeng</SelectItem>
            <SelectItem value='17'>Ali</SelectItem>
            <SelectItem value='suno'>Suno</SelectItem>
            <SelectItem value='mj'>Midjourney</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1.5'>
        <Label>{t('filter.status')}</Label>
        <Select
          value={draft.status}
          onValueChange={(status) => setDraft((d) => ({ ...d, status }))}
        >
          <SelectTrigger className='bg-bg-0'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filter.all')}</SelectItem>
            <SelectItem value='NOT_START'>{t('status.NOT_START')}</SelectItem>
            <SelectItem value='SUBMITTED'>{t('status.SUBMITTED')}</SelectItem>
            <SelectItem value='QUEUED'>{t('status.QUEUED')}</SelectItem>
            <SelectItem value='IN_PROGRESS'>{t('status.IN_PROGRESS')}</SelectItem>
            <SelectItem value='SUCCESS'>{t('status.SUCCESS')}</SelectItem>
            <SelectItem value='FAILURE'>{t('status.FAILURE')}</SelectItem>
            <SelectItem value='UNKNOWN'>{t('status.UNKNOWN')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1.5'>
        <Label>{t('filter.task_id')}</Label>
        <Input
          value={draft.task_id}
          onChange={(event) => setDraft((d) => ({ ...d, task_id: event.target.value }))}
          className='bg-bg-0'
        />
      </div>
      <div className='space-y-1.5'>
        <Label>{t('filter.action')}</Label>
        <Input
          value={draft.action}
          onChange={(event) => setDraft((d) => ({ ...d, action: event.target.value }))}
          className='bg-bg-0'
        />
      </div>
      <div className='flex items-end gap-2'>
        <Button type='button' onClick={() => onChange(draft)}>
          <Search className='size-4' />
          {t('filter.apply')}
        </Button>
        <Button
          type='button'
          variant='secondary'
          onClick={() => {
            setDraft(EMPTY_FILTERS);
            onChange(EMPTY_FILTERS);
          }}
        >
          {t('filter.clear')}
        </Button>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  quota,
  onOpen,
}: {
  task: AsyncTask;
  quota: string;
  onOpen: (task: AsyncTask) => void;
}) {
  const { t } = useTranslation('tasks');
  const progress = progressNumber(task.progress);
  const input = taskInput(task);

  return (
    <tr className='border-b border-line text-13 hover:bg-bg-1'>
      <td className='px-3 py-3 align-top'>
        <div className='flex min-w-[180px] items-center gap-2'>
          <span className='truncate font-mono text-12'>{task.task_id}</span>
          <button
            type='button'
            className='text-fg-2 hover:text-fg-0'
            aria-label={t('action.copy_task_id')}
            onClick={() => void copyText(task.task_id, t('toast.copied'))}
          >
            <Copy className='size-3.5' />
          </button>
        </div>
        <div className='mt-1 text-12 text-fg-2'>
          {fmtDateSec(task.submit_time || task.created_at)}
        </div>
      </td>
      <td className='px-3 py-3 align-top'>
        <Badge variant='outline'>{platformLabel(task.platform)}</Badge>
        <div className='mt-1 text-12 text-fg-2'>{task.action || '-'}</div>
      </td>
      <td className='max-w-[220px] px-3 py-3 align-top'>
        <div className='truncate font-medium'>{taskModel(task)}</div>
        {input ? <div className='mt-1 truncate text-12 text-fg-2'>{input}</div> : null}
      </td>
      <td className='px-3 py-3 align-top'>
        <Badge variant={statusVariant(task.status)}>
          {t(`status.${task.status}`, task.status)}
        </Badge>
        <div className='mt-2 h-1.5 w-[120px] overflow-hidden rounded-full bg-bg-2'>
          <div
            className={cn(
              'h-full rounded-full',
              task.status === 'FAILURE' ? 'bg-danger' : 'bg-success'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className='mt-1 text-12 text-fg-2'>{task.progress || '-'}</div>
      </td>
      <td className='px-3 py-3 text-right align-top tabular-nums'>{quota}</td>
      <td className='px-3 py-3 align-top text-fg-1'>{fmtDateSec(task.updated_at)}</td>
      <td className='px-3 py-3 align-top'>
        <div className='flex justify-end gap-2'>
          {task.result_url ? (
            <Button asChild size='icon' variant='outline' className='size-8'>
              <a
                href={task.result_url}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={t('action.open_result')}
              >
                <ExternalLink className='size-4' />
              </a>
            </Button>
          ) : null}
          <Button
            type='button'
            size='icon'
            variant='secondary'
            className='size-8'
            onClick={() => onOpen(task)}
          >
            <Eye className='size-4' />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function TasksPage() {
  const { t } = useTranslation('tasks');
  const cfg = usePublicConfig();
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AsyncTask | null>(null);

  const queryParams = useMemo(
    () => ({
      platform: filters.platform === ALL ? undefined : filters.platform,
      status: filters.status === ALL ? undefined : filters.status,
      task_id: filters.task_id.trim() || undefined,
      action: filters.action.trim() || undefined,
      p: page,
      page_size: PAGE_SIZE,
    }),
    [filters, page]
  );
  const tasks = useMyTasks(queryParams);
  const items = tasks.data?.items ?? [];
  const total = tasks.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-3 md:flex-row md:items-end md:justify-between'>
        <div>
          <h1 className='text-20 font-semibold'>{t('page.title')}</h1>
          <p className='mt-1 text-13 text-fg-2'>{t('page.subtitle')}</p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={tasks.isFetching}
          onClick={() => void tasks.refetch()}
        >
          <RefreshCw className={cn('size-4', tasks.isFetching && 'animate-spin')} />
          {t('action.refresh')}
        </Button>
      </div>

      <TaskFiltersBar
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />

      {tasks.isError ? (
        <InlineBanner
          level='danger'
          message={String((tasks.error as Error).message)}
          onClose={() => void tasks.refetch()}
        />
      ) : null}

      {tasks.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className='h-12 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
          <div className='text-15 font-medium text-fg-0'>{t('empty.title')}</div>
          <div className='mt-1 text-13 text-fg-2'>{t('empty.body')}</div>
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border border-line'>
          <table className='w-full min-w-[980px] border-collapse'>
            <thead>
              <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
                <th className='px-3 py-2 font-medium'>{t('col.task')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.platform')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.model')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.status')}</th>
                <th className='px-3 py-2 text-right font-medium'>{t('col.quota')}</th>
                <th className='px-3 py-2 font-medium'>{t('col.updated')}</th>
                <th className='px-3 py-2 text-right font-medium'>{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((task) => (
                <TaskRow
                  key={task.id || task.task_id}
                  task={task}
                  quota={fmtDisplay(task.quota, cfg)}
                  onOpen={setDetail}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='flex items-center justify-between py-3 text-13 text-fg-2'>
        <div>{t('pagination.total', { total })}</div>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={page <= 1 || tasks.isPending}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('pagination.prev')}
          </Button>
          <span className='tabular-nums'>{t('pagination.page', { page, pageCount })}</span>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={page >= pageCount || tasks.isPending}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('pagination.next')}
          </Button>
        </div>
      </div>

      <TaskDetailDialog task={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}
