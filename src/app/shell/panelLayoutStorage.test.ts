import { afterEach, describe, expect, it } from 'vitest';
import {
  panelLayoutStorage,
  persistSidebarOpen,
  readPersistedSidebarOpen,
} from './panelLayoutStorage';

const SIDEBAR_OPEN_STORAGE_KEY = 'lumamark.sidebar-open.v1';

describe('sidebar visibility storage', () => {
  afterEach(() => {
    panelLayoutStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, '');
  });

  it('round trips an explicit collapsed state independently of panel sizing', () => {
    persistSidebarOpen(false);

    expect(readPersistedSidebarOpen()).toBe(false);
  });

  it('ignores an invalid persisted value', () => {
    panelLayoutStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, 'invalid');

    expect(readPersistedSidebarOpen()).toBeNull();
  });
});
