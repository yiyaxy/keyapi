import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../helpers';

const MAX_ATTACHMENTS = 5;

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

async function putPresignedObject(uploadUrl, requiredHeaders, file, contentType) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: normalizeHeaders(requiredHeaders, contentType),
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload failed: ${res.status} ${text}`.trim());
  }
}

export function useTicketUserData() {
  const { t } = useTranslation();

  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchTickets = useCallback(async (p, ps) => {
    setLoading(true);
    try {
      const url = `/api/ticket?p=${p || 1}&page_size=${ps || 10}`;
      const res = await API.get(url);
      const { success, data, message } = res.data;
      if (success && data) {
        setTickets(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total) || 0);

        if (data.page) setPage(Number(data.page) || 1);
        if (data.page_size) setPageSize(Number(data.page_size) || 10);
        return true;
      }
      showError(message || '');
      return false;
    } catch (e) {
      showError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTicketDetail = useCallback(async (id) => {
    try {
      const res = await API.get(`/api/ticket/${id}`);
      const { success, data, message } = res.data;
      if (success && data) {
        const ticket = data.ticket && typeof data.ticket === 'object' ? data.ticket : data;
        const replies = Array.isArray(data.replies)
          ? data.replies
          : Array.isArray(ticket?.replies)
            ? ticket.replies
            : Array.isArray(ticket?.ticket_replies)
              ? ticket.ticket_replies
              : [];
        const attachments = Array.isArray(data.attachments)
          ? data.attachments
          : Array.isArray(ticket?.attachments)
            ? ticket.attachments
            : [];

        return {
          ...(ticket || {}),
          replies,
          ticket_replies: replies,
          attachments,
        };
      }
      showError(message || '');
      return null;
    } catch (e) {
      showError(e.message);
      return null;
    }
  }, []);

  const presignAndUpload = useCallback(async (file) => {
    const contentType = file?.type || 'application/octet-stream';
    const req = {
      filename: file?.name || 'file',
      content_type: contentType,
      size_bytes: Number(file?.size) || 0,
    };

    const res = await API.post('/api/ticket/uploads/presign', req);
    const { success, data, message } = res.data;
    if (!success || !data) {
      throw new Error(message || 'presign failed');
    }

    await putPresignedObject(data.upload_url, data.required_headers, file, contentType);
    return String(data.object_key || '').trim();
  }, []);

  const createTicket = useCallback(async ({ subject, content, files }) => {
    try {
      const selected = Array.isArray(files) ? files.filter(Boolean).slice(0, MAX_ATTACHMENTS) : [];
      if (Array.isArray(files) && files.length > MAX_ATTACHMENTS) {
        showError(t('tickets.attachmentLimitExceeded'));
      }

      if (selected.length > 0) {
        showSuccess(t('tickets.uploading'));
      }

      const objectKeys = [];
      for (const f of selected) {
        const key = await presignAndUpload(f);
        if (key) objectKeys.push(key);
      }

      const uniqueObjectKeys = Array.from(
        new Set(objectKeys.map((k) => String(k || '').trim()).filter(Boolean)),
      );

      const payload = {
        subject: String(subject || '').trim(),
        content: String(content || '').trim(),
        object_keys: uniqueObjectKeys,
      };

      const res = await API.post('/api/ticket', payload);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('tickets.createSuccess'));
        return true;
      }
      showError(message || '');
      return false;
    } catch (e) {
      showError(e.message || t('tickets.uploadFailed'));
      return false;
    }
  }, [presignAndUpload, t]);

  const replyTicket = useCallback(async (ticketId, { content, files }) => {
    try {
      const selected = Array.isArray(files) ? files.filter(Boolean).slice(0, MAX_ATTACHMENTS) : [];
      const objectKeys = [];
      for (const f of selected) {
        const key = await presignAndUpload(f);
        if (key) objectKeys.push(key);
      }

      const uniqueObjectKeys = Array.from(
        new Set(objectKeys.map((k) => String(k || '').trim()).filter(Boolean)),
      );

      const payload = {
        content: String(content || '').trim(),
        object_keys: uniqueObjectKeys,
      };

      const res = await API.post(`/api/ticket/${ticketId}/reply`, payload);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('tickets.replySuccess'));
        return true;
      }
      showError(message || '');
      return false;
    } catch (e) {
      showError(e.message || t('tickets.uploadFailed'));
      return false;
    }
  }, [presignAndUpload, t]);

  const presignAttachment = useCallback(async (attId, opts = {}) => {
    try {
      let url = `/api/ticket/attachments/${attId}/presign`;
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

  return {
    tickets,
    total,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    fetchTickets,
    fetchTicketDetail,
    createTicket,
    replyTicket,
    presignAttachment,
  };
}
