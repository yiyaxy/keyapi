import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

export function useInvoiceUserData() {
  const { t } = useTranslation();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const listInvoiceableOrders = useCallback(async (p, ps, keyword) => {
    setLoading(true);
    try {
      let url = `/api/invoice/self/invoiceable_orders?page=${p || 1}&page_size=${ps || 10}`;
      const kw = String(keyword || '').trim();
      if (kw) url += `&keyword=${encodeURIComponent(kw)}`;

      const res = await API.get(url);
      const { success, data, message } = res.data;
      if (success && data) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total) || 0);
        if (data.page) setPage(Number(data.page) || 1);
        if (data.page_size) setPageSize(Number(data.page_size) || 10);
        return true;
      }
      showError(message || t('invoice.error'));
      return false;
    } catch (e) {
      showError(e.message || t('invoice.error'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const createApplication = useCallback(
    async ({ invoiceType, title, taxId, email, applyRemark, goodsName, taxClassificationCode, taxRateValue, issueKindCode, selectedItems }) => {
      try {
        const items = Array.isArray(selectedItems) ? selectedItems.filter(Boolean) : [];
        const payloadItems = items.map((it) => ({
          source_type: String(it?.source_type || '').trim(),
          source_id: Number(it?.source_id) || 0,
        }));

        const payload = {
          invoice_type: String(invoiceType || '').trim(),
          title: String(title || '').trim(),
          tax_id: String(taxId || '').trim(),
          email: String(email || '').trim(),
          apply_remark: String(applyRemark || '').trim(),
          goods_name: String(goodsName || '').trim(),
          tax_classification_code: String(taxClassificationCode || '').trim(),
          tax_rate_value: String(taxRateValue || '').trim(),
          issue_kind_code: String(issueKindCode || '').trim(),
          items: payloadItems,
        };

        const res = await API.post('/api/invoice/self/applications', payload);
        const { success, data, message } = res.data;
        if (success && data) {
          return data;
        }
        showError(message || '');
        return null;
      } catch (e) {
        showError(e.message || t('invoice.createFailed'));
        return null;
      }
    },
    [t],
  );

  const presignFile = useCallback(async (fileId, opts = {}) => {
    try {
      let url = `/api/invoice/self/files/${fileId}/presign`;
      const disposition = opts?.disposition;
      if (disposition) {
        url += `?disposition=${encodeURIComponent(disposition)}`;
      }
      const res = await API.get(url);
      const { success, data, message } = res.data;
      if (success) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const [appItems, setAppItems] = useState([]);
  const [appTotal, setAppTotal] = useState(0);
  const [appLoading, setAppLoading] = useState(false);
  const [appPage, setAppPage] = useState(1);
  const [appPageSize, setAppPageSize] = useState(10);

  const fetchApplications = useCallback(async (p, ps, { status, keyword } = {}) => {
    setAppLoading(true);
    try {
      let url = `/api/invoice/self/applications?page=${p || 1}&page_size=${ps || 10}`;
      if (status) url += `&status=${encodeURIComponent(status)}`;
      const kw = String(keyword || '').trim();
      if (kw) url += `&keyword=${encodeURIComponent(kw)}`;

      const res = await API.get(url);
      const { success, data, message } = res.data;
      if (success && data) {
        setAppItems(Array.isArray(data.items) ? data.items : []);
        setAppTotal(Number(data.total) || 0);
        if (data.page) setAppPage(Number(data.page) || 1);
        if (data.page_size) setAppPageSize(Number(data.page_size) || 10);
        return true;
      }
      showError(message || t('invoice.error'));
      return false;
    } catch (e) {
      showError(e.message || t('invoice.error'));
      return false;
    } finally {
      setAppLoading(false);
    }
  }, []);

  const fetchApplicationDetail = useCallback(async (id) => {
    try {
      const res = await API.get(`/api/invoice/self/applications/${id}`);
      const { success, data, message } = res.data;
      if (success && data) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const cancelApplication = useCallback(async (id) => {
    try {
      const res = await API.post(`/api/invoice/self/applications/${id}/cancel`);
      const { success, data, message } = res.data;
      if (success) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const moneyTotal = useMemo(() => {
    const total = (Array.isArray(items) ? items : []).reduce((sum, it) => {
      const v = Number(it?.money) || 0;
      return sum + v;
    }, 0);
    return total;
  }, [items]);

  return {
    items,
    total,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,

    listInvoiceableOrders,
    createApplication,
    presignFile,

    moneyTotal,

    appItems,
    appTotal,
    appLoading,
    appPage,
    setAppPage,
    appPageSize,
    setAppPageSize,
    fetchApplications,
    fetchApplicationDetail,
    cancelApplication,
  };
}
