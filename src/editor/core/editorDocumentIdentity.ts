import type { EditorDocumentContext } from './editorDisplayMode';

export type EditorDocumentContextPatch = Partial<EditorDocumentContext>;

const untitledSessionId = createUntitledSessionId();
let untitledSequence = 0;

/**
 * Thin editor-side identity helper.
 *
 * Desktop file identity is owned by Rust `DocumentPathIdentity` / claim
 * routing. Callers should pass that `documentId` when they have it. This
 * module only mints untitled ids and a browser fallback that hashes the
 * path bytes as supplied — it does not fold Windows drive/UNC spellings.
 */
export function createInitialEditorDocumentContext(
  context?: EditorDocumentContext,
): EditorDocumentContext {
  const path = context?.path ?? null;

  return {
    ...context,
    documentId:
      context?.documentId ?? createFallbackDocumentId(path),
    path,
    plantuml: context?.plantuml ?? { enabled: true },
  };
}

export function applyEditorDocumentContextPatch(
  current: EditorDocumentContext,
  patch: EditorDocumentContextPatch,
): EditorDocumentContext {
  const pathWasPatched = Object.prototype.hasOwnProperty.call(patch, 'path');
  const documentIdWasPatched = Object.prototype.hasOwnProperty.call(
    patch,
    'documentId',
  );
  const requestedPath = pathWasPatched ? patch.path ?? null : current.path;
  const documentId =
    documentIdWasPatched && patch.documentId !== undefined
      ? patch.documentId
      : pathWasPatched
        ? createFallbackDocumentId(requestedPath)
        : current.documentId ?? createFallbackDocumentId(requestedPath);

  return {
    ...current,
    ...patch,
    documentId,
    path: requestedPath,
  };
}

export function createFallbackDocumentId(path: string | null): string {
  if (path === null) {
    return createUntitledDocumentId();
  }

  return `document:file:${fnv1a64(path)}`;
}

function createUntitledDocumentId(): string {
  untitledSequence += 1;
  return `document:untitled:${untitledSessionId}:${untitledSequence.toString(36)}`;
}

function createUntitledSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
