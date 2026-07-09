const fallbackPanelLayoutStorage = new Map<string, string>();

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
