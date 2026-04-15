/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

// Get user ID from localStorage for New-API-User header
function getUserIdFromLocalStorage(): number {
  const user = localStorage.getItem('user');
  if (!user) return -1;
  try {
    const parsed = JSON.parse(user);
    return parsed.id ?? -1;
  } catch {
    return -1;
  }
}

// Create axios instance with default config
export let API: AxiosInstance = axios.create({
  baseURL: '', // Empty for dev proxy (configured in vite.config.ts)
  headers: {
    'New-API-User': getUserIdFromLocalStorage(),
    'Cache-Control': 'no-store',
  },
});

// Patch API instance to deduplicate concurrent GET requests
function patchAPIInstance(instance: AxiosInstance): void {
  const originalGet = instance.get.bind(instance);
  const inFlightGetRequests = new Map<string, Promise<any>>();

  const genKey = (url: string, config: any = {}): string => {
    const params = config.params ? JSON.stringify(config.params) : '{}';
    return `${url}?${params}`;
  };

  instance.get = ((url: string, config: any = {}) => {
    if (config?.disableDuplicate) {
      return originalGet(url, config);
    }

    const key = genKey(url, config);
    if (inFlightGetRequests.has(key)) {
      return inFlightGetRequests.get(key)!;
    }

    const reqPromise = originalGet(url, config).finally(() => {
      inFlightGetRequests.delete(key);
    });

    inFlightGetRequests.set(key, reqPromise);
    return reqPromise;
  }) as any;
}

patchAPIInstance(API);

function attachResponseInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    (error: AxiosError) => {
    // Skip global error handling if explicitly requested
    const config = error.config as InternalAxiosRequestConfig & { skipErrorHandler?: boolean };
    if (config?.skipErrorHandler) {
      return Promise.reject(error);
    }

    // Global error handling
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as any;

      if (status === 401) {
        console.error('Unauthorized - please login');
      } else if (status === 403) {
        console.error('Forbidden - insufficient permissions');
      } else if (status >= 500) {
        console.error('Server error:', data?.message || error.message);
      } else {
        console.error('API error:', data?.message || error.message);
      }
    } else if (error.request) {
      console.error('Network error - no response received');
    } else {
      console.error('Request error:', error.message);
    }

    return Promise.reject(error);
    }
  );
}

attachResponseInterceptor(API);

// Update API instance (call after login/logout to refresh New-API-User header)
export function updateAPI(): void {
  API = axios.create({
    baseURL: '',
    headers: {
      'New-API-User': getUserIdFromLocalStorage(),
      'Cache-Control': 'no-store',
    },
  });

  patchAPIInstance(API);
  attachResponseInterceptor(API);
}
