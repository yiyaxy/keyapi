import { useState, useCallback, useEffect } from 'react';
import { API, showError, showSuccess } from '../../../helpers';

const DEFAULT_PAGE_SIZE = 20;

/**
 * 成员列表 + invite + updateRole + updateStatus + remove 的复合 hook。
 * 列表接口返回 { success, data: { page_size, total, items: TenantMemberListItem[] } }
 * 后端 pageInfo 结构见 common.PageInfo（Page/PageSize/Total/Items）。
 */
export function useTenantMembersData() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState(0); // 0 = 全部
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (keyword) params.set('keyword', keyword);
      if (statusFilter > 0) params.set('status', String(statusFilter));
      const res = await API.get(`/api/tenant/members?${params.toString()}`);
      if (res?.data?.success) {
        const d = res.data.data || {};
        const rawItems = d.items || d.Items || [];
        setItems(Array.isArray(rawItems) ? rawItems : []);
        const t = d.total ?? d.Total ?? 0;
        setTotal(typeof t === 'number' ? t : 0);
      } else {
        showError(res?.data?.message || '加载成员失败');
      }
    } catch (err) {
      showError(err?.message || '加载成员失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter]);

  const invite = useCallback(
    async ({ email, role }) => {
      try {
        const res = await API.post('/api/tenant/invite', { email, role });
        if (res?.data?.success) {
          const d = res.data.data || {};
          if (d.status === 'joined') {
            showSuccess('已将现有用户加入本租户');
          } else if (d.status === 'invited') {
            showSuccess(`邀请已创建，token: ${d.token}`);
          }
          await load();
          return d;
        }
        showError(res?.data?.message || '邀请失败');
        return null;
      } catch (err) {
        showError(err?.message || '邀请失败');
        return null;
      }
    },
    [load],
  );

  const updateRoleOrStatus = useCallback(
    async ({ user_id, role, status }) => {
      try {
        const body = { user_id };
        if (typeof role === 'number' && role > 0) body.role = role;
        if (typeof status === 'number' && status > 0) body.status = status;
        const res = await API.put('/api/tenant/members', body);
        if (res?.data?.success) {
          showSuccess('已更新');
          await load();
          return true;
        }
        showError(res?.data?.message || '更新失败');
        return false;
      } catch (err) {
        showError(err?.message || '更新失败');
        return false;
      }
    },
    [load],
  );

  const remove = useCallback(
    async (user_id) => {
      try {
        const res = await API.delete('/api/tenant/members', { data: { user_id } });
        if (res?.data?.success) {
          showSuccess('已移除成员');
          await load();
          return true;
        }
        showError(res?.data?.message || '移除失败');
        return false;
      } catch (err) {
        showError(err?.message || '移除失败');
        return false;
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  // 筛选变化时自动回到第 1 页，避免"当前 page 超出过滤后总页数"造成的空表假象。
  const setKeywordAndReset = useCallback((v) => {
    setKeyword(v);
    setPage(1);
  }, []);
  const setStatusFilterAndReset = useCallback((v) => {
    setStatusFilter(v);
    setPage(1);
  }, []);

  return {
    items,
    total,
    page,
    pageSize,
    keyword,
    statusFilter,
    loading,
    setPage,
    setPageSize,
    setKeyword: setKeywordAndReset,
    setStatusFilter: setStatusFilterAndReset,
    reload: load,
    invite,
    updateRoleOrStatus,
    remove,
  };
}
