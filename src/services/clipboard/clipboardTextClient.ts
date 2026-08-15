import { isTauri } from '@tauri-apps/api/core';
import {
  readText as readNativeText,
  writeText as writeNativeText,
} from '@tauri-apps/plugin-clipboard-manager';

export type ClipboardTextPort = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

type ClipboardTextPortResolverDependencies = {
  isDesktopRuntime: () => boolean;
  nativeReadText: () => Promise<string>;
  nativeWriteText: (text: string) => Promise<void>;
  resolveBrowserClipboard: () => ClipboardTextPort | null;
};

export function createClipboardTextPortResolver(
  dependencies: ClipboardTextPortResolverDependencies,
): () => ClipboardTextPort | null {
  const nativeClipboard: ClipboardTextPort = {
    readText: () => dependencies.nativeReadText(),
    writeText: (text) => dependencies.nativeWriteText(text),
  };

  return () =>
    dependencies.isDesktopRuntime()
      ? nativeClipboard
      : dependencies.resolveBrowserClipboard();
}

export const resolveClipboardTextPort = createClipboardTextPortResolver({
  isDesktopRuntime: isTauri,
  nativeReadText: readNativeText,
  nativeWriteText: writeNativeText,
  resolveBrowserClipboard,
});

export async function writeClipboardText(text: string): Promise<void> {
  const clipboard = resolveClipboardTextPort();
  if (typeof clipboard?.writeText !== 'function') {
    throw new Error('The text clipboard is unavailable.');
  }

  await clipboard.writeText(text);
}

function resolveBrowserClipboard(): ClipboardTextPort | null {
  try {
    const clipboard =
      typeof navigator === 'undefined' ? null : navigator.clipboard;
    if (!clipboard) {
      return null;
    }

    const port: ClipboardTextPort = {};
    if (typeof clipboard.readText === 'function') {
      port.readText = () => clipboard.readText();
    }
    if (typeof clipboard.writeText === 'function') {
      port.writeText = (text) => clipboard.writeText(text);
    }

    return port.readText || port.writeText ? port : null;
  } catch {
    return null;
  }
}
