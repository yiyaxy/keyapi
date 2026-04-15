import { useState, useEffect, useCallback } from 'react';
import { API, showError, showSuccess } from '../../helpers';

export const useIpBanData = () => {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/ip/bans');
      if (res.data.success) {
        setBans(res.data.data || []);
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBans();
  }, [fetchBans]);

  const banIp = useCallback(
    async (ip, reason, expireAt) => {
      try {
        const res = await API.post('/api/ip/ban', {
          ip,
          reason: reason || '',
          expire_at: expireAt || 0,
        });
        if (res.data.success) {
          showSuccess(res.data.message);
          await fetchBans();
          return true;
        } else {
          showError(res.data.message);
          return false;
        }
      } catch (e) {
        showError(e.message);
        return false;
      }
    },
    [fetchBans],
  );

  const unbanIp = useCallback(
    async (ip) => {
      try {
        const res = await API.post('/api/ip/unban', { ip });
        if (res.data.success) {
          showSuccess(res.data.message);
          await fetchBans();
          return true;
        } else {
          showError(res.data.message);
          return false;
        }
      } catch (e) {
        showError(e.message);
        return false;
      }
    },
    [fetchBans],
  );

  const isIpBanned = useCallback(
    (ip) => {
      return bans.some((ban) => ban.ip === ip);
    },
    [bans],
  );

  return { bans, loading, fetchBans, banIp, unbanIp, isIpBanned };
};
