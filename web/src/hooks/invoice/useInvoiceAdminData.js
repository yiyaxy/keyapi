import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError } from '../../helpers';

function normalizeHeaders(requiredHeaders, contentType) {
  const headers = new Headers();
  const entries = requiredHeaders && typeof requiredHeaders === 'object' ? Object.entries(requiredHeaders) : [];
  for (const [k, v] of entries) {
    if (!k) continue;
    headers.set(k, String(v));
  }

  const hasContentType = Array.from(headers.keys()).some((k) => k.toLowerCase() === 'content-type');
  if (!hasContentType && contentType) {
    headers.set('Content-Type', contentType);
  }
  return headers;
}

async function putPresignedObject(uploadUrl, requiredHeaders, file, contentType, onProgress, t) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);

    const entries = requiredHeaders && typeof requiredHeaders === 'object' ? Object.entries(requiredHeaders) : [];
    let hasContentType = false;
    for (const [k, v] of entries) {
      if (!k) continue;
      xhr.setRequestHeader(k, String(v));
      if (k.toLowerCase() === 'content-type') hasContentType = true;
    }
    if (!hasContentType && contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(t('invoice.uploadFailed')));
    };
    xhr.onerror = () => reject(new Error(t('invoice.uploadNetworkError')));
    xhr.send(file);
  });
}

export function useInvoiceAdminData() {
  const { t } = useTranslation();
  const [appItems, setAppItems] = useState([]);
  const [appTotal, setAppTotal] = useState(0);
  const [appLoading, setAppLoading] = useState(false);
  const [appPage, setAppPage] = useState(1);
  const [appPageSize, setAppPageSize] = useState(10);

  const fetchApplications = useCallback(async (p, ps, { status, keyword, userId } = {}) => {
    setAppLoading(true);
    try {
      let url = `/api/invoice/admin/applications?page=${p || 1}&page_size=${ps || 10}`;
      if (status) url += `&status=${encodeURIComponent(status)}`;
      const kw = String(keyword || '').trim();
      if (kw) url += `&keyword=${encodeURIComponent(kw)}`;
      if (userId) url += `&user_id=${encodeURIComponent(userId)}`;

      const res = await API.get(url);
      const { success, data, message } = res.data;
      if (success && data) {
        setAppItems(Array.isArray(data.items) ? data.items : []);
        setAppTotal(Number(data.total) || 0);
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
      const res = await API.get(`/api/invoice/admin/applications/${id}`);
      const { success, data, message } = res.data;
      if (success && data) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const updateApplicationStatus = useCallback(async (id, { status, admin_remark, reject_reason, goods_name, tax_classification_code, tax_rate_value } = {}) => {
    try {
      const payload = {};
      if (status) payload.status = status;
      if (admin_remark) payload.admin_remark = admin_remark;
      if (reject_reason) payload.reject_reason = reject_reason;
      if (goods_name) payload.goods_name = goods_name;
      if (tax_classification_code) payload.tax_classification_code = tax_classification_code;
      if (tax_rate_value) payload.tax_rate_value = tax_rate_value;

      const res = await API.post(`/api/invoice/admin/applications/${id}/status`, payload);
      const { success, data, message } = res.data;
      if (success) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const queryApplicationStatus = useCallback(async (id) => {
    try {
      const res = await API.post(`/api/invoice/admin/applications/${id}/query`);
      const { success, data, message } = res.data;
      if (success) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const issueApplication = useCallback(async (id) => {
    try {
      const res = await API.post(`/api/invoice/admin/applications/${id}/issue`);
      const { success, data, message } = res.data;
      if (success) return data;
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const setItemPaymentInfo = useCallback(async (appId, itemId, payload) => {
    try {
      const res = await API.post(`/api/invoice/admin/applications/${appId}/items/${itemId}/payment_info`, payload);
      const { success, message } = res.data;
      if (success) return true;
      showError(message || '');
      return false;
    } catch (e) {
      showError(e.message);
      return false;
    }
  }, []);

  const presignAndUpload = useCallback(async ({ invoiceId, file, onProgress }) => {
    const contentType = file?.type || 'application/octet-stream';
    const req = {
      invoice_id: Number(invoiceId) || 0,
      filename: file?.name || 'file',
      content_type: contentType,
      size_bytes: Number(file?.size) || 0,
    };

    const res = await API.post('/api/invoice/admin/uploads/presign', req);
    const { success, data, message } = res.data;
    if (!success || !data) {
      throw new Error(message || t('invoice.presignFailed'));
    }

    await putPresignedObject(data.upload_url, data.required_headers, file, contentType, onProgress, t);
    return String(data.object_key || '').trim();
  }, [t]);

  const finalizeInvoiceFiles = useCallback(async ({ invoiceId, objectKeys }) => {
    try {
      const uniqueObjectKeys = Array.from(
        new Set((Array.isArray(objectKeys) ? objectKeys : []).map((k) => String(k || '').trim()).filter(Boolean)),
      );

      const res = await API.post(`/api/invoice/admin/applications/${invoiceId}/files`, {
        object_keys: uniqueObjectKeys,
      });
      const { success, data, message } = res.data;
      if (success && data) {
        return Array.isArray(data.files) ? data.files : [];
      }
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const presignFile = useCallback(async (fileId, opts = {}) => {
    try {
      let url = `/api/invoice/admin/files/${fileId}/presign`;
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

  const redInvoice = useCallback(
    async (id, redReason) => {
      try {
        const res = await API.post(`/api/invoice/admin/applications/${id}/red`, { red_reason: redReason });
        const { success, message } = res.data;
        if (success) return true;
        showError(message || t('invoice.redFailed'));
        return false;
      } catch (e) {
        showError(e.message || t('invoice.redFailed'));
        return false;
      }
    },
    [t]
  );

  const updateFileUserVisibility = useCallback(async (invoiceId, fileId, isUserVisible) => {
    try {
      const res = await API.post(`/api/invoice/admin/applications/${invoiceId}/files/${fileId}/visibility`, {
        is_user_visible: Boolean(isUserVisible),
      });
      const { success, data, message } = res.data;
      if (success) return data || true;
      showError(message || t('invoice.error'));
      return null;
    } catch (e) {
      showError(e.message || t('invoice.error'));
      return null;
    }
  }, [t]);

  return {
    presignAndUpload,
    finalizeInvoiceFiles,
    presignFile,

    appItems,
    appTotal,
    appLoading,
    appPage,
    setAppPage,
    appPageSize,
    setAppPageSize,
    fetchApplications,
    fetchApplicationDetail,
    updateApplicationStatus,
    queryApplicationStatus,
    issueApplication,
    setItemPaymentInfo,
    redInvoice,
    updateFileUserVisibility,
  };
}

