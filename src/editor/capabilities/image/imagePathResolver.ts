export type ResolvedImageSource =
  | { kind: 'error'; reason: 'relative_without_document' }
  | { kind: 'resolved'; src: string };

export function resolveMarkdownImageSource({
  documentPath,
  source,
}: {
  documentPath: string | null;
  source: string;
}): ResolvedImageSource {
  if (/^(?:https?:|data:|blob:)/i.test(source)) {
    return { kind: 'resolved', src: source };
  }

  if (isAbsolutePath(source)) {
    return { kind: 'resolved', src: toAssetUrl(source) };
  }

  if (!documentPath) {
    return { kind: 'error', reason: 'relative_without_document' };
  }

  return {
    kind: 'resolved',
    src: toAssetUrl(resolveRelativePath(documentPath, source)),
  };
}

export function isAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\');
}

export function isDraftImageSource(source: string): boolean {
  return source.startsWith('lumamark-draft://');
}

function resolveRelativePath(documentPath: string, source: string): string {
  const separator = documentPath.includes('\\') ? '\\' : '/';
  const directory = documentPath.replace(/[\\/][^\\/]*$/, '');
  const parts = `${directory}${separator}${source}`.split(/[\\/]+/);
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  if (/^[a-z]:$/i.test(resolved[0] ?? '')) {
    return `${resolved[0]}\\${resolved.slice(1).join('\\')}`;
  }

  return `${documentPath.startsWith('/') ? '/' : ''}${resolved.join(separator)}`;
}

function toAssetUrl(path: string): string {
  const tauriInternals = (
    globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (filePath: string, protocol?: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;

  return tauriInternals?.convertFileSrc
    ? tauriInternals.convertFileSrc(path)
    : `asset://localhost/${encodeURIComponent(path)}`;
}
