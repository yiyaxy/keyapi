import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import i18n from 'i18next';

import { loadBootstrap } from './bootstrap';
import { logError } from './observability';

export class ApiError extends Error {
  status: number;
  code: string;
  backendMessage?: string;
  fieldErrors?: Record<string, string>;

  constructor(message: string, status = 0, code = 'unknown') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static fromBody(body: {
    message?: string;
    code?: string;
    errors?: Record<string, string>;
  }): ApiError {
    const msg = body.message ?? 'Unknown error';
    const e = new ApiError(msg, 0, body.code ?? 'unknown');
    e.backendMessage = body.message;
    e.fieldErrors = body.errors;
    return e;
  }
}

type AuthEvent = 'unauthorized' | 'forbidden';
type AuthListener = (e: AuthEvent) => void;
const authListeners = new Set<AuthListener>();

export function onAuthEvent(fn: AuthListener): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function emitAuthEvent(e: AuthEvent): void {
  authListeners.forEach((l) => {
    try {
      l(e);
    } catch (err) {
      logError(err, { tag: 'auth-event-listener' });
    }
  });
}

type ToastListener = (kind: 'error', message: string) => void;
const toastListeners = new Set<ToastListener>();

export function onToast(fn: ToastListener): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

function emitToast(kind: 'error', message: string): void {
  toastListeners.forEach((l) => {
    try {
      l(kind, message);
    } catch (err) {
      logError(err, { tag: 'toast-listener' });
    }
  });
}

export const api = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

// 挑一个"当前 host 对应"的默认 tenant id 发给后端。
// 仅用于 bootstrap 尚未写入（未登录）的场景：登录请求也要带，否则后端
// fail-closed 会把整个 auth 流程拦掉。
//
// 规则：
//   - 子域名部署（acme.example.com）—— 返回 null，让后端按子域名解析
//   - localhost / IP / 扁平域名（example.com） —— 返回 "1"，对齐 DefaultTenantId
//   - www / api 这种保留子域也按扁平域名处理
function fallbackTenantIdForHost(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (!host) return null;
  if (host === 'localhost') return '1';
  if (/^\d+(\.\d+){3}$/.test(host)) return '1'; // IPv4
  if (host.includes(':')) return '1'; // IPv6 literal
  const parts = host.split('.');
  if (parts.length < 3) return '1';
  const slug = parts[0];
  if (slug === 'www' || slug === 'api') return '1';
  return null;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const boot = loadBootstrap();
  if (boot) {
    config.headers.set('New-API-User', String(boot.id));
    config.headers.set('X-Tenant-Id', String(boot.tenant_id));
  } else {
    // 未登录时仍需带 X-Tenant-Id，后端解析不到就直接 fail-closed。
    const fb = fallbackTenantIdForHost();
    if (fb !== null) {
      config.headers.set('X-Tenant-Id', fb);
    }
  }
  if (i18n.language) {
    config.headers.set('Accept-Language', i18n.language);
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const body = response.data as {
      success?: boolean;
      data?: unknown;
      message?: string;
      code?: string;
    };
    if (body && typeof body === 'object' && body.success === false) {
      throw ApiError.fromBody(body);
    }
    if (body && typeof body === 'object' && 'data' in body) {
      response.data = body.data;
    }
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const body = error.response.data as Record<string, unknown> | undefined;
      if (status === 401) {
        emitAuthEvent('unauthorized');
        const e = new ApiError('Unauthorized', 401, 'unauthorized');
        e.backendMessage = typeof body?.message === 'string' ? body.message : undefined;
        return Promise.reject(e);
      }
      if (status === 403) {
        emitAuthEvent('forbidden');
        const e = new ApiError('Forbidden', 403, 'forbidden');
        e.backendMessage = typeof body?.message === 'string' ? body.message : undefined;
        return Promise.reject(e);
      }
      if (status >= 500) {
        emitToast('error', 'Server error. Try again in a moment.');
        const e = new ApiError('Server error', status, 'server_error');
        return Promise.reject(e);
      }
      if (body && typeof body === 'object') {
        return Promise.reject(
          ApiError.fromBody(
            body as { message?: string; code?: string; errors?: Record<string, string> }
          )
        );
      }
      return Promise.reject(new ApiError(error.message, status, 'unknown'));
    }
    emitToast('error', 'Network error. Check your connection.');
    return Promise.reject(new ApiError(error.message || 'Network error', 0, 'network'));
  }
);
