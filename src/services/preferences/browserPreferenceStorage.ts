export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type PreferenceStorage = KeyValueStorage & Pick<Storage, 'removeItem'>;

const jsdomPreferenceValues = new Map<string, string>();
const jsdomPreferenceStorage: PreferenceStorage = {
  getItem: (name) => jsdomPreferenceValues.get(name) ?? null,
  removeItem: (name) => {
    jsdomPreferenceValues.delete(name);
  },
  setItem: (name, value) => {
    jsdomPreferenceValues.set(name, value);
  },
};

function isJsdomRuntime(): boolean {
  return (globalThis.navigator?.userAgent.toLowerCase() ?? '').includes(
    'jsdom',
  );
}

function resolveDefaultStorage(): PreferenceStorage {
  if (isJsdomRuntime()) {
    return jsdomPreferenceStorage;
  }

  const storage = globalThis.document?.defaultView?.localStorage;

  if (!storage) {
    throw new Error('Browser preference storage is unavailable.');
  }

  return storage;
}

function resolveStrictDefaultStorage(): KeyValueStorage {
  if (isJsdomRuntime()) {
    throw new Error('Browser preference storage is unavailable.');
  }

  const storage = globalThis.document?.defaultView?.localStorage;

  if (!storage) {
    throw new Error('Browser preference storage is unavailable.');
  }

  return storage;
}

export function createBrowserPreferenceStorage(
  resolveStorage: () => PreferenceStorage = resolveDefaultStorage,
): PreferenceStorage {
  return {
    getItem: (name) => resolveStorage().getItem(name),
    removeItem: (name) => {
      resolveStorage().removeItem(name);
    },
    setItem: (name, value) => {
      resolveStorage().setItem(name, value);
    },
  };
}

export function createStrictBrowserPreferenceStorage(
  resolveStorage: () => KeyValueStorage = resolveStrictDefaultStorage,
): KeyValueStorage {
  return {
    getItem: (name) => resolveStorage().getItem(name),
    setItem: (name, value) => {
      resolveStorage().setItem(name, value);
    },
  };
}

export const browserPreferenceStorage = createBrowserPreferenceStorage();
export const strictBrowserPreferenceStorage =
  createStrictBrowserPreferenceStorage();
