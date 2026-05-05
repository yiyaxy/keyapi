import { useState } from 'react';

import {
  ChatHistoryDetailDrawer,
  type ChatHistoryDetailDrawerProps,
} from '@/components/chat-history/ChatHistoryDetailDrawer';
import {
  ChatHistoryFilters,
  type ChatHistoryFilterValues,
} from '@/components/chat-history/ChatHistoryFilters';
import { ChatHistoryTable } from '@/components/chat-history/ChatHistoryTable';
import { LogsPagination } from '@/components/logs/LogsPagination';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatHistoryList } from '@/hooks/useChatHistory';

const PAGE_SIZE = 20;

const INITIAL: ChatHistoryFilterValues = {
  user_id: 0,
  model: '',
  from: 0,
  to: 0,
  tenant_id: 0,
};

/**
 * Admin-only page to browse captured chat conversation envelopes. Backed by
 * /api/chat_history/admin (list + detail). Tenant scoping is enforced
 * server-side based on the caller's role:
 *   - Platform admin: sees all tenants by default; can filter via tenant_id.
 *   - Tenant admin: server pins to their tenant regardless of any query.
 *
 * Recording is OFF by default — when no rows show up, point the operator at
 * the "图片生成" / chat_history record_messages toggle in settings.
 */
export function ChatHistoryAdminPage() {
  const [filters, setFilters] = useState<ChatHistoryFilterValues>(INITIAL);
  const [page, setPage] = useState(1);
  const [activeRequestId, setActiveRequestId] =
    useState<ChatHistoryDetailDrawerProps['requestId']>(null);

  const query = useChatHistoryList({
    user_id: filters.user_id || undefined,
    model: filters.model || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    tenant_id: filters.tenant_id || undefined,
    page,
    size: PAGE_SIZE,
  });

  return (
    <div className='space-y-4'>
      <ChatHistoryFilters
        value={filters}
        onChange={(v) => {
          setFilters(v);
          setPage(1);
        }}
      />
      {query.isPending ? (
        <div className='space-y-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-9 w-full' />
          ))}
        </div>
      ) : query.data?.items.length ? (
        <>
          <ChatHistoryTable
            rows={query.data.items}
            onRowClick={(r) => setActiveRequestId(r.request_id)}
          />
          <LogsPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState />
      )}
      <ChatHistoryDetailDrawer
        requestId={activeRequestId}
        onOpenChange={(o) => {
          if (!o) setActiveRequestId(null);
        }}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className='rounded-md border border-line bg-bg-1 p-8 text-center'>
      <div className='text-15 font-medium text-fg-0'>暂无对话记录</div>
      <div className='mt-1 text-13 text-fg-2'>
        默认未开启对话内容记录。请在 设置 → 对话历史 中打开 "记录对话内容"
        开关后，新发生的对话会被记录到对象存储。
      </div>
    </div>
  );
}
