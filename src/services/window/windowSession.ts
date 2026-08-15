import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export function resolveWindowSessionId(): string {
  if (
    typeof window === 'undefined' ||
    !('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  ) {
    return 'main';
  }

  const label = getCurrentWebviewWindow().label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error('Tauri window session metadata is unavailable.');
  }
  return label;
}
