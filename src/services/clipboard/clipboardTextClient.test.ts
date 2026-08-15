import { describe, expect, it, vi } from 'vitest';
import { createClipboardTextPortResolver } from './clipboardTextClient';

describe('clipboard text client', () => {
  it('uses the native text adapter in a Tauri runtime without probing the WebView clipboard', async () => {
    const nativeReadText = vi.fn().mockResolvedValue('native text');
    const nativeWriteText = vi.fn().mockResolvedValue(undefined);
    const resolveBrowserClipboard = vi.fn();
    const resolveClipboard = createClipboardTextPortResolver({
      isDesktopRuntime: () => true,
      nativeReadText,
      nativeWriteText,
      resolveBrowserClipboard,
    });

    const clipboard = resolveClipboard();

    await expect(clipboard?.readText?.()).resolves.toBe('native text');
    await expect(clipboard?.writeText?.('written')).resolves.toBeUndefined();
    expect(nativeWriteText).toHaveBeenCalledWith('written');
    expect(resolveBrowserClipboard).not.toHaveBeenCalled();
  });

  it('propagates native failures without probing or falling back to the WebView clipboard', async () => {
    const readFailure = new Error('native read failed');
    const writeFailure = new Error('native write failed');
    const resolveBrowserClipboard = vi.fn(() => ({
      readText: vi.fn().mockResolvedValue('unsafe fallback'),
      writeText: vi.fn().mockResolvedValue(undefined),
    }));
    const resolveClipboard = createClipboardTextPortResolver({
      isDesktopRuntime: () => true,
      nativeReadText: vi.fn().mockRejectedValue(readFailure),
      nativeWriteText: vi.fn().mockRejectedValue(writeFailure),
      resolveBrowserClipboard,
    });

    const clipboard = resolveClipboard();

    await expect(clipboard?.readText?.()).rejects.toBe(readFailure);
    await expect(clipboard?.writeText?.('text')).rejects.toBe(writeFailure);
    expect(resolveBrowserClipboard).not.toHaveBeenCalled();
  });

  it('keeps the navigator adapter for the browser fallback', async () => {
    const browserReadText = vi.fn().mockResolvedValue('browser text');
    const browserWriteText = vi.fn().mockResolvedValue(undefined);
    const resolveBrowserClipboard = vi.fn(() => ({
      readText: browserReadText,
      writeText: browserWriteText,
    }));
    const nativeReadText = vi.fn();
    const nativeWriteText = vi.fn();
    const resolveClipboard = createClipboardTextPortResolver({
      isDesktopRuntime: () => false,
      nativeReadText,
      nativeWriteText,
      resolveBrowserClipboard,
    });

    const clipboard = resolveClipboard();

    await expect(clipboard?.readText?.()).resolves.toBe('browser text');
    await expect(clipboard?.writeText?.('written')).resolves.toBeUndefined();
    expect(browserWriteText).toHaveBeenCalledWith('written');
    expect(nativeReadText).not.toHaveBeenCalled();
    expect(nativeWriteText).not.toHaveBeenCalled();
  });

  it('reports an unavailable browser clipboard without throwing', () => {
    const resolveClipboard = createClipboardTextPortResolver({
      isDesktopRuntime: () => false,
      nativeReadText: vi.fn(),
      nativeWriteText: vi.fn(),
      resolveBrowserClipboard: () => null,
    });

    expect(resolveClipboard()).toBeNull();
  });
});
