import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveWindowSessionId } from './windowSession';

const tauriMocks = vi.hoisted(() => ({
  label: 'document-7',
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: tauriMocks.label }),
}));

describe('window session identity', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    tauriMocks.label = 'document-7';
  });

  it('uses a deterministic main identity outside Tauri', () => {
    expect(resolveWindowSessionId()).toBe('main');
  });

  it('uses the current native window label without sharing another window draft', () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    expect(resolveWindowSessionId()).toBe('document-7');
  });

  it('fails closed when native session metadata has no usable label', () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriMocks.label = '  ';

    expect(() => resolveWindowSessionId()).toThrow(
      'Tauri window session metadata is unavailable.',
    );
  });
});
