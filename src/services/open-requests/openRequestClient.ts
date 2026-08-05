import { listen } from '@tauri-apps/api/event';
import {
  invokeCommand,
  type CommandResult,
} from '../tauri/invokeCommand';

export const OPEN_REQUESTS_AVAILABLE_EVENT =
  'desktop-open-requests-available';

export type OpenRequest = {
  path: string;
};

export type OpenRequestClient = {
  drain: () => Promise<CommandResult<OpenRequest[]>>;
  listen: (listener: () => void) => Promise<() => void>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_OPEN_REQUESTS__?: OpenRequestClient;
  }
}

const noopClient: OpenRequestClient = {
  drain: async () => ({ ok: true, data: [] }),
  listen: async () => () => undefined,
};

const tauriClient: OpenRequestClient = {
  drain: () => invokeCommand<OpenRequest[]>('open_requests_drain'),
  async listen(listener) {
    return listen(OPEN_REQUESTS_AVAILABLE_EVENT, listener);
  },
};

export function resolveOpenRequestClient(): OpenRequestClient {
  if (import.meta.env.MODE === 'test') {
    return typeof window !== 'undefined' &&
      window.__LUMAMARK_E2E_OPEN_REQUESTS__
      ? window.__LUMAMARK_E2E_OPEN_REQUESTS__
      : noopClient;
  }

  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.__LUMAMARK_E2E_OPEN_REQUESTS__
  ) {
    return window.__LUMAMARK_E2E_OPEN_REQUESTS__;
  }

  if (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window
  ) {
    return tauriClient;
  }

  return noopClient;
}
