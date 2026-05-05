import type { ChatHistoryListItem } from '@/hooks/useChatHistory';

type Props = {
  rows: ChatHistoryListItem[];
  onRowClick: (row: ChatHistoryListItem) => void;
};

export function ChatHistoryTable({ rows, onRowClick }: Props) {
  return (
    <div className='overflow-x-auto rounded-md border border-line bg-bg-1'>
      <table className='w-full border-collapse tabular-nums'>
        <thead>
          <tr className='border-b border-line bg-bg-1 text-left text-12 uppercase text-fg-2'>
            <th className='px-3 py-2 font-medium'>时间</th>
            <th className='px-3 py-2 font-medium'>用户</th>
            <th className='px-3 py-2 font-medium'>模型</th>
            <th className='px-3 py-2 font-medium'>类型</th>
            <th className='px-3 py-2 text-right font-medium'>tokens</th>
            <th className='px-3 py-2 text-right font-medium'>耗时</th>
            <th className='px-3 py-2 text-right font-medium'>包大小</th>
            <th className='px-3 py-2 font-medium'>request_id</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className='cursor-pointer border-b border-line text-13 hover:bg-bg-2'
              onClick={() => onRowClick(r)}
            >
              <td className='px-3 py-2 text-fg-1'>{formatTs(r.created_at)}</td>
              <td className='px-3 py-2'>
                <div className='text-fg-1'>{r.username || '—'}</div>
                <div className='text-12 text-fg-3'>#{r.user_id}</div>
              </td>
              <td className='px-3 py-2'>{r.model_name || '—'}</td>
              <td className='px-3 py-2 text-12'>
                {r.is_stream ? <Badge tone='blue'>stream</Badge> : <Badge tone='gray'>json</Badge>}
              </td>
              <td className='px-3 py-2 text-right'>
                {(r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)}
              </td>
              <td className='px-3 py-2 text-right'>{formatMs(r.use_time_ms)}</td>
              <td className='px-3 py-2 text-right text-12 text-fg-2'>
                {formatBytes(r.message_size_bytes)}
              </td>
              <td
                className='px-3 py-2 font-mono text-12 text-fg-2'
                title={r.request_id}
              >
                {truncateMid(r.request_id, 18)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'blue' | 'gray' }) {
  const cls =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-bg-2 text-fg-2 border-line';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${cls}`}>
      {children}
    </span>
  );
}

function formatTs(unix: number): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatMs(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(b: number): string {
  if (!b) return '—';
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

// Show first N/2 chars + … + last N/2 chars so request_id columns stay
// scannable but still distinguishable. Pure cosmetics; full id is in tooltip.
function truncateMid(s: string | undefined, max: number): string {
  if (!s) return '—';
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + '…' + s.slice(s.length - half);
}
