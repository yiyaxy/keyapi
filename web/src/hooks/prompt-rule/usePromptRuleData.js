import { useState, useEffect, useCallback } from 'react';
import { API, showError, showSuccess } from '../../helpers';
import { useTranslation } from 'react-i18next';

export function usePromptRuleData() {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/prompt_rule/?p=${page}&page_size=${pageSize}&keyword=${keyword}`);
      const { success, data } = res.data;
      if (success) {
        setRules(data.items || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      showError(e.message);
    }
    setLoading(false);
  }, [page, pageSize, keyword]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const createRule = async (rule) => {
    const res = await API.post('/api/prompt_rule/', rule);
    if (res.data.success) {
      showSuccess(t('创建成功'));
      loadRules();
      return true;
    }
    return false;
  };

  const updateRule = async (rule) => {
    const res = await API.put('/api/prompt_rule/', rule);
    if (res.data.success) {
      showSuccess(t('更新成功'));
      loadRules();
      return true;
    }
    return false;
  };

  const deleteRule = async (id) => {
    const res = await API.delete(`/api/prompt_rule/${id}`);
    if (res.data.success) {
      showSuccess(t('删除成功'));
      loadRules();
    }
  };

  const toggleEnabled = async (rule) => {
    await updateRule({ ...rule, enabled: !rule.enabled });
  };

  return {
    rules, loading, total, page, pageSize, keyword,
    setPage, setPageSize, setKeyword,
    createRule, updateRule, deleteRule, toggleEnabled, loadRules,
  };
}
