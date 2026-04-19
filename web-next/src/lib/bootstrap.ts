const KEY = 'new-api.auth-bootstrap';

export type AuthBootstrap = {
  id: number;
  tenant_id: number;
};

export function loadBootstrap(): AuthBootstrap | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as AuthBootstrap).id === 'number') {
      const tenantId =
        typeof (parsed as AuthBootstrap).tenant_id === 'number'
          ? (parsed as AuthBootstrap).tenant_id
          : 1;
      return { id: (parsed as AuthBootstrap).id, tenant_id: tenantId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBootstrap(payload: AuthBootstrap): void {
  localStorage.setItem(KEY, JSON.stringify(payload));
}

export function clearBootstrap(): void {
  localStorage.removeItem(KEY);
}
