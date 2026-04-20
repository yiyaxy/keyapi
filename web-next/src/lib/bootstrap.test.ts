import { afterEach, describe, expect, test } from 'vitest';

import { clearBootstrap, loadBootstrap, saveBootstrap } from './bootstrap';

afterEach(() => localStorage.clear());

describe('auth bootstrap', () => {
  test('returns null when nothing stored', () => {
    expect(loadBootstrap()).toBeNull();
  });

  test('round trips { id, tenant_id }', () => {
    saveBootstrap({ id: 42, tenant_id: 7 });
    expect(loadBootstrap()).toEqual({ id: 42, tenant_id: 7 });
  });

  test('ignores malformed payloads', () => {
    localStorage.setItem('new-api.auth-bootstrap', '{not json');
    expect(loadBootstrap()).toBeNull();
  });

  test('ignores payloads missing id', () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ tenant_id: 7 }));
    expect(loadBootstrap()).toBeNull();
  });

  test('clearBootstrap removes the key', () => {
    saveBootstrap({ id: 42, tenant_id: 7 });
    clearBootstrap();
    expect(loadBootstrap()).toBeNull();
  });
});
