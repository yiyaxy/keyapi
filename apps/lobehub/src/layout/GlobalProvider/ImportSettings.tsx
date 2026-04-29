'use client';

import { memo, useEffect, useState } from 'react';

import { LOBE_URL_IMPORT_NAME } from '@/const/url';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';

const ImportSettings = memo(() => {
  const refreshAiProviderRuntimeState = useAiInfraStore((s) => s.refreshAiProviderRuntimeState);
  const [importUrlShareSettings, isUserStateInit] = useUserStore((s) => [
    s.importUrlShareSettings,
    s.isUserStateInit,
  ]);

  // Read initial URL param using browser API (not router-dependent)
  const [searchParam, setSearchParam] = useState<string>('');

  useEffect(() => {
    // Read from URL on mount
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const param = params.get(LOBE_URL_IMPORT_NAME);
      if (param) {
        setSearchParam(param);
        // Clear the param from URL after reading
        params.delete(LOBE_URL_IMPORT_NAME);
        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, []);

  useEffect(() => {
    // Why use `usUserStateInit`,
    // see: https://github.com/lobehub/lobe-chat/pull/4072
    if (searchParam && isUserStateInit) {
      void (async () => {
        await importUrlShareSettings(searchParam);
        await refreshAiProviderRuntimeState();
      })();
    }
  }, [searchParam, isUserStateInit, importUrlShareSettings, refreshAiProviderRuntimeState]);

  return null;
});

export default ImportSettings;
