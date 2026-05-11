import { loadBootstrap } from './bootstrap';

const DEFAULT_LLM_BASE_URL = 'https://token.cymoon.cn/v1';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export const LLM_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_LLM_BASE_URL || DEFAULT_LLM_BASE_URL
);

export function llmUrl(path: string) {
  return `${LLM_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

export function getLlmTenantId() {
  return loadBootstrap()?.tenant_id;
}

export function getLlmRequestHeaders(token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const tenantId = getLlmTenantId();
  if (tenantId) headers['X-Tenant-Id'] = String(tenantId);
  return headers;
}
