const fallbackPanelLayoutStorage = new Map<string, string>();
const SIDEBAR_OPEN_STORAGE_KEY = 'lumamark.sidebar-open.v1';

function isJsdomRuntime(): boolean {
  const userAgent = globalThis.navigator?.userAgent.toLowerCase() ?? '';

  return userAgent.includes('jsdom');
}

function getPanelLayoutBrowserStorage(): Storage | null {
  if (isJsdomRuntime()) {
    return null;
  }

  try {
    return globalThis.document?.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

export const panelLayoutStorage = {
  getItem(key: string) {
    try {
      const storage = getPanelLayoutBrowserStorage();

      if (storage && typeof storage.getItem === 'function') {
        return storage.getItem(key);
      }
    } catch {
      return fallbackPanelLayoutStorage.get(key) ?? null;
    }

    return fallbackPanelLayoutStorage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    try {
      const storage = getPanelLayoutBrowserStorage();

      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(key, value);
        return;
      }
    } catch {
      fallbackPanelLayoutStorage.set(key, value);
      return;
    }

    fallbackPanelLayoutStorage.set(key, value);
  },
};

export function readPersistedSidebarOpen(): boolean | null {
  const value = panelLayoutStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
}

export function persistSidebarOpen(sidebarOpen: boolean): void {
  panelLayoutStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
}
