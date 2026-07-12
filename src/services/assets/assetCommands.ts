import { convertFileSrc } from '@tauri-apps/api/core';
import { replaceLocalImageTargets as replaceWatchedLocalImageTargets } from '../file-watch/fileWatchClient';
import {
  invokeBinaryCommand,
  invokeCommand,
  type CommandResult,
  type InvokeBinaryCommandFunction,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export type CacheRemoteImageInput = {
  documentPath: string;
  source: string;
};

export type ImportDocumentImageInput = {
  bytes: Uint8Array;
  documentPath: string;
  mimeType: string;
};

export type CopyLocalImageInput = {
  documentPath: string;
  sourcePath: string;
};

export type AuthorizeLocalImageInput = {
  documentPath: string | null;
  source: string;
};

export type ImportDocumentImageResult = {
  markdownSource: string;
  path: string;
};

export type ImportDraftImageInput = {
  bytes: Uint8Array;
  draftId: string;
  mimeType: string;
};


export type CacheRemoteImageResult = {
  byteLength: number;
  cacheHit: boolean;
  path: string;
};

export type RemoteImageAssetRequest = {
  documentPath: string | null;
  source: string;
};

export type RemoteImageAssetResolution =
  | {
      kind: 'error';
      reason:
        | 'local_authorization_failed'
        | 'remote_cache_failed'
        | 'unsaved_remote_cache_unavailable';
    }
  | { kind: 'resolved'; src: string };

export type RemoteImageAssetResolver = (
  request: RemoteImageAssetRequest,
) => Promise<RemoteImageAssetResolution>;

export type LocalImageSourceSyncInput = {
  documentPath: string | null;
  sources: readonly string[];
};

export type SyncingRemoteImageAssetResolver = RemoteImageAssetResolver & {
  getLocalSourceRevision: (source: string) => number | undefined;
  invalidateLocalPath: (path: string) => void;
  syncLocalSources: (input: LocalImageSourceSyncInput) => Promise<void>;
};

type AssetCommandOptions = {
  invokeBinaryFn?: InvokeBinaryCommandFunction;
  invokeFn?: InvokeCommandFunction;
};

export type E2EAssetCommandClient = {
  copyLocalImage?: (
    input: CopyLocalImageInput,
  ) => Promise<CommandResult<ImportDocumentImageResult>>;
  finalizeDraftImages?: (input: { documentPath: string; draftId: string; text: string }) => Promise<CommandResult<string>>;
  authorizeLocalImage?: (
    input: AuthorizeLocalImageInput,
  ) => Promise<CommandResult<string>>;
  cacheRemoteImage?: (
    input: CacheRemoteImageInput,
  ) => Promise<CommandResult<CacheRemoteImageResult>>;
  importDocumentImage?: (
    input: ImportDocumentImageInput,
  ) => Promise<CommandResult<ImportDocumentImageResult>>;
  importDraftImage?: (
    input: ImportDraftImageInput,
  ) => Promise<CommandResult<ImportDocumentImageResult>>;
};

export async function copyLocalImage(
  input: CopyLocalImageInput,
  options: AssetCommandOptions = {},
): Promise<CommandResult<ImportDocumentImageResult>> {
  const e2eClient = e2eAssetClient();

  if (e2eClient?.copyLocalImage) {
    return e2eClient.copyLocalImage(input);
  }

  return invokeCommand<ImportDocumentImageResult>(
    'assets_copy_local_image',
    {
      documentPath: input.documentPath,
      sourcePath: input.sourcePath,
    },
    options.invokeFn,
  );
}

function e2eAssetClient(): E2EAssetCommandClient | undefined {
  if (typeof window === 'undefined' || !import.meta.env.DEV) {
    return undefined;
  }

  return window.__LUMAMARK_E2E_ASSET_COMMANDS__;
}

export async function cacheRemoteImage(
  input: CacheRemoteImageInput,
  options: AssetCommandOptions = {},
): Promise<CommandResult<CacheRemoteImageResult>> {
  const e2eClient = e2eAssetClient();

  if (e2eClient?.cacheRemoteImage) {
    return e2eClient.cacheRemoteImage(input);
  }

  return invokeCommand<CacheRemoteImageResult>(
    'assets_cache_remote_image',
    {
      documentPath: input.documentPath,
      source: input.source,
    },
    options.invokeFn,
  );
}

export async function importDocumentImage(
  input: ImportDocumentImageInput,
  options: AssetCommandOptions = {},
): Promise<CommandResult<ImportDocumentImageResult>> {
  const e2eClient = e2eAssetClient();

  if (e2eClient?.importDocumentImage) {
    return e2eClient.importDocumentImage(input);
  }

  return invokeBinaryCommand<ImportDocumentImageResult>(
    'assets_import_document_image',
    createImageImportPayload({
      documentPath: input.documentPath,
      mimeType: input.mimeType,
    }, input.bytes),
    options.invokeBinaryFn,
  );
}

export async function importDraftImage(
  input: ImportDraftImageInput,
  options: AssetCommandOptions = {},
): Promise<CommandResult<ImportDocumentImageResult>> {
  const e2eClient = e2eAssetClient();

  if (e2eClient?.importDraftImage) {
    return e2eClient.importDraftImage(input);
  }

  return invokeBinaryCommand<ImportDocumentImageResult>(
    'assets_import_draft_image',
    createImageImportPayload({
      draftId: input.draftId,
      mimeType: input.mimeType,
    }, input.bytes),
    options.invokeBinaryFn,
  );
}

export function createImageImportPayload(
  metadata: Record<string, string>,
  bytes: Uint8Array,
): Uint8Array {
  const encodedMetadata = new TextEncoder().encode(JSON.stringify(metadata));
  const payload = new Uint8Array(4 + encodedMetadata.byteLength + bytes.byteLength);
  new DataView(payload.buffer).setUint32(0, encodedMetadata.byteLength, true);
  payload.set(encodedMetadata, 4);
  payload.set(bytes, 4 + encodedMetadata.byteLength);
  return payload;
}

export async function finalizeDraftImages(
  input: { documentPath: string; draftId: string; text: string },
  options: AssetCommandOptions = {},
): Promise<CommandResult<string>> {
  const e2eClient = e2eAssetClient();
  if (e2eClient?.finalizeDraftImages) {
    return e2eClient.finalizeDraftImages(input);
  }
  return invokeCommand<string>(
    'assets_finalize_draft_images',
    {
      documentPath: input.documentPath,
      draftId: input.draftId,
      text: input.text,
    },
    options.invokeFn,
  );
}

export async function finalizeAllDraftImages(
  input: { documentPath: string; text: string },
  options: {
    finalize?: typeof finalizeDraftImages;
  } = {},
): Promise<string> {
  const draftIds = [
    ...input.text.matchAll(/lumamark-draft:\/\/([^/\s)]+)\//g),
  ].map((match) => match[1]);
  const uniqueDraftIds = [...new Set(draftIds)];
  const finalize = options.finalize ?? finalizeDraftImages;
  let text = input.text;

  for (const draftId of uniqueDraftIds) {
    const result = await finalize({
      documentPath: input.documentPath,
      draftId,
      text,
    });
    if (!result.ok) {
      throw new Error(result.error.code);
    }
    text = result.data;
  }

  return text;
}

export async function authorizeLocalImage(
  input: AuthorizeLocalImageInput,
  options: AssetCommandOptions = {},
): Promise<CommandResult<string>> {
  const e2eClient = e2eAssetClient();

  if (e2eClient?.authorizeLocalImage) {
    return e2eClient.authorizeLocalImage(input);
  }

  return invokeCommand<string>(
    'assets_authorize_local_image',
    { documentPath: input.documentPath, source: input.source },
    options.invokeFn,
  );
}

declare global {
  interface Window {
    __LUMAMARK_E2E_ASSET_COMMANDS__?: E2EAssetCommandClient;
  }
}

export function cachedImagePathToAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export function createRemoteImageAssetResolver(options: {
  authorizeImage?: (
    input: AuthorizeLocalImageInput,
  ) => Promise<CommandResult<string>>;
  cacheImage?: (
    input: CacheRemoteImageInput,
  ) => Promise<CommandResult<CacheRemoteImageResult>>;
  getLocalImageRevision?: (path: string) => number | undefined;
  onLocalImageWatchError?: (error: unknown) => void;
  replaceLocalImageTargets?: (paths: readonly string[]) => Promise<unknown>;
  toAssetUrl?: (path: string) => string;
} = {}): SyncingRemoteImageAssetResolver {
  const cacheImage = options.cacheImage ?? cacheRemoteImage;
  const authorizeImage = options.authorizeImage ?? authorizeLocalImage;
  const getLocalImageRevision = options.getLocalImageRevision;
  const onLocalImageWatchError = options.onLocalImageWatchError;
  const replaceLocalImageTargets =
    options.replaceLocalImageTargets ?? replaceWatchedLocalImageTargets;
  const toAssetUrl = options.toAssetUrl ?? cachedImagePathToAssetUrl;
  const pending = new Map<string, Promise<RemoteImageAssetResolution>>();
  const authorizedLocalPaths = new Map<string, string>();
  const invalidatedLocalPaths = new Set<string>();
  let activeDocumentPath: string | null = null;
  let activeLocalSources = new Set<string>();
  let lastAppliedWatchTargets: string | undefined;
  let watchSyncGeneration = 0;
  let watchSyncQueue: Promise<void> = Promise.resolve();

  const syncWatchTargets = (): Promise<void> => {
    const paths = [...activeLocalSources]
      .map((source) => authorizedLocalPaths.get(source))
      .filter((path): path is string => Boolean(path));
    const uniquePaths = [...new Set(paths)];
    const signature = JSON.stringify(
      uniquePaths.map(normalizeLocalPathKey).sort(),
    );
    const generation = ++watchSyncGeneration;
    const task = watchSyncQueue.then(async () => {
      if (
        generation !== watchSyncGeneration ||
        signature === lastAppliedWatchTargets
      ) {
        return;
      }

      const result = await replaceLocalImageTargets(uniquePaths);
      if (isFailedCommandResult(result)) {
        throw new Error(result.error.code);
      }
      lastAppliedWatchTargets = signature;
    });
    watchSyncQueue = task.catch(() => undefined);
    return task;
  };

  const syncWatchTargetsWithReporting = async (): Promise<void> => {
    try {
      await syncWatchTargets();
    } catch (error) {
      if (!onLocalImageWatchError) {
        throw error;
      }
      onLocalImageWatchError(error);
    }
  };

  const resolver: SyncingRemoteImageAssetResolver = async (request) => {
    if (!isRemoteHttpSource(request.source)) {
      if (
        !isAbsoluteImagePath(request.source) &&
        !request.source.startsWith('lumamark-draft://') &&
        !request.documentPath
      ) {
        return { kind: 'error', reason: 'unsaved_remote_cache_unavailable' };
      }

      const knownPath = authorizedLocalPaths.get(request.source);
      if (
        knownPath &&
        request.documentPath === activeDocumentPath &&
        !invalidatedLocalPaths.has(normalizeLocalPathKey(knownPath))
      ) {
        return {
          kind: 'resolved',
          src: localImagePathToAssetUrl(
            knownPath,
            toAssetUrl,
            getLocalImageRevision,
          ),
        };
      }

      const result = await authorizeImage(request);
      if (!result.ok) {
        return { kind: 'error', reason: 'local_authorization_failed' };
      }

      if (
        request.documentPath === activeDocumentPath &&
        activeLocalSources.has(request.source)
      ) {
        authorizedLocalPaths.set(request.source, result.data);
        if (knownPath) {
          invalidatedLocalPaths.delete(normalizeLocalPathKey(knownPath));
        }
        invalidatedLocalPaths.delete(normalizeLocalPathKey(result.data));
        await syncWatchTargetsWithReporting();
      }

      return {
        kind: 'resolved',
        src: localImagePathToAssetUrl(
          result.data,
          toAssetUrl,
          getLocalImageRevision,
        ),
      };
    }

    if (!request.documentPath) {
      return { kind: 'error', reason: 'unsaved_remote_cache_unavailable' };
    }

    const key = `${request.documentPath}\u0000${request.source}`;
    const existing = pending.get(key);

    if (existing) {
      return existing;
    }

    const task = cacheImage({
      documentPath: request.documentPath,
      source: request.source,
    })
      .then((result): RemoteImageAssetResolution => {
        if (!result.ok) {
          return { kind: 'error', reason: 'remote_cache_failed' };
        }

        return { kind: 'resolved', src: toAssetUrl(result.data.path) };
      })
      .catch(
        (): RemoteImageAssetResolution => ({
          kind: 'error',
          reason: 'remote_cache_failed',
        }),
      )
      .finally(() => {
        pending.delete(key);
      });

    pending.set(key, task);
    return task;
  };

  resolver.syncLocalSources = async (input) => {
    if (input.documentPath !== activeDocumentPath) {
      activeDocumentPath = input.documentPath;
      authorizedLocalPaths.clear();
      invalidatedLocalPaths.clear();
    }

    const sources = new Set(
      input.sources.filter(isWatchableLocalImageSource),
    );
    for (const source of authorizedLocalPaths.keys()) {
      if (!sources.has(source)) {
        authorizedLocalPaths.delete(source);
      }
    }
    activeLocalSources = sources;
    await syncWatchTargetsWithReporting();
  };

  resolver.getLocalSourceRevision = (source) => {
    const path = authorizedLocalPaths.get(source);
    return path ? getLocalImageRevision?.(path) : undefined;
  };

  resolver.invalidateLocalPath = (path) => {
    invalidatedLocalPaths.add(normalizeLocalPathKey(path));
  };

  return resolver;
}

export type LocalImageReference = {
  alt: string;
  markdownSource: string;
};

export async function createLocalImageReferences(
  input: {
    copyToAssets: boolean;
    documentPath: string | null;
    paths: readonly string[];
  },
  options: {
    copyImage?: (
      input: CopyLocalImageInput,
    ) => Promise<CommandResult<ImportDocumentImageResult>>;
  } = {},
): Promise<LocalImageReference[]> {
  const documentPath = input.documentPath;

  if (!input.copyToAssets || !documentPath) {
    return input.paths.map((path) => ({
      alt: fileNameFromPath(path),
      markdownSource: path,
    }));
  }

  const copyImage = options.copyImage ?? copyLocalImage;
  const copied: LocalImageReference[] = [];

  for (const sourcePath of input.paths) {
    const result = await copyImage({
      documentPath,
      sourcePath,
    });

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    copied.push({
      alt: fileNameFromPath(sourcePath),
      markdownSource: result.data.markdownSource,
    });
  }

  return copied;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || 'image';
}

function isAbsoluteImagePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\');
}

function isRemoteHttpSource(source: string): boolean {
  return /^https?:/i.test(source);
}

function isWatchableLocalImageSource(source: string): boolean {
  return !/^(?:https?:|data:|blob:|lumamark-draft:)/i.test(source);
}

function isFailedCommandResult(
  value: unknown,
): value is Extract<CommandResult<unknown>, { ok: false }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false
  );
}

export function normalizeLocalPathKey(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const windowsDrive = /^[a-z]:\//i.test(normalized);
  const windowsUnc = normalized.startsWith('//');
  const absolute = windowsDrive || windowsUnc || normalized.startsWith('/');
  const parts: string[] = [];

  for (const part of normalized.split('/')) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      const previous = parts.at(-1);
      if (previous && previous !== '..' && !/^[a-z]:$/i.test(previous)) {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }

    parts.push(part);
  }

  const lexicalPath = windowsUnc
    ? `//${parts.join('/')}`
    : normalized.startsWith('/') && !windowsDrive
      ? `/${parts.join('/')}`
      : parts.join('/');

  return windowsDrive || windowsUnc
    ? lexicalPath.toLocaleLowerCase('en-US')
    : lexicalPath;
}

function localImagePathToAssetUrl(
  path: string,
  toAssetUrl: (path: string) => string,
  getRevision?: (path: string) => number | undefined,
): string {
  const assetUrl = toAssetUrl(path);
  const revision = getRevision?.(path);

  if (revision === undefined) {
    return assetUrl;
  }

  const fragmentIndex = assetUrl.indexOf('#');
  const fragment = fragmentIndex >= 0 ? assetUrl.slice(fragmentIndex) : '';
  const base = fragmentIndex >= 0 ? assetUrl.slice(0, fragmentIndex) : assetUrl;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}lmv=${encodeURIComponent(String(revision))}${fragment}`;
}
