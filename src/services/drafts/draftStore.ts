import { resolveWindowSessionId } from '../window/windowSession';

export type RecoveryDraft = {
  filePath: string | null;
  text: string;
};

const legacyRecoveryDraftKey = 'lumamark-recovery-draft-v1';
const recoveryDraftKeyPrefix = 'lumamark-recovery-draft-v2:';

function recoveryDraftKey(sessionId: string): string {
  return `${recoveryDraftKeyPrefix}${encodeURIComponent(sessionId)}`;
}

function getStorage(): Storage | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    const storage =
      descriptor && 'value' in descriptor
        ? (descriptor.value as Storage | undefined)
        : typeof process !== 'undefined' && process.versions?.node
          ? null
          : globalThis.document?.defaultView?.localStorage;

    return storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

export function saveRecoveryDraft(
  draft: RecoveryDraft,
  sessionId = resolveWindowSessionId(),
): void {
  try {
    const storage = getStorage();
    storage?.setItem(recoveryDraftKey(sessionId), JSON.stringify(draft));
    if (sessionId === 'main') {
      storage?.removeItem(legacyRecoveryDraftKey);
    }
  } catch {
    // Recovery must never disrupt the active editing session.
  }
}

export function readRecoveryDraft(
  sessionId = resolveWindowSessionId(),
): RecoveryDraft | null {
  let serialized: string | null | undefined;
  let migratedLegacy = false;

  try {
    const storage = getStorage();
    serialized = storage?.getItem(recoveryDraftKey(sessionId));
    if (!serialized && sessionId === 'main') {
      serialized = storage?.getItem(legacyRecoveryDraftKey);
      migratedLegacy = Boolean(serialized);
    }
  } catch {
    return null;
  }

  if (!serialized) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(serialized);

    if (
      !value ||
      typeof value !== 'object' ||
      !('filePath' in value) ||
      !('text' in value) ||
      (value.filePath !== null && typeof value.filePath !== 'string') ||
      typeof value.text !== 'string'
    ) {
      return null;
    }

    const draft = { filePath: value.filePath, text: value.text };
    if (migratedLegacy) {
      saveRecoveryDraft(draft, sessionId);
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearRecoveryDraft(
  sessionId = resolveWindowSessionId(),
): void {
  try {
    const storage = getStorage();
    storage?.removeItem(recoveryDraftKey(sessionId));
    if (sessionId === 'main') {
      storage?.removeItem(legacyRecoveryDraftKey);
    }
  } catch {
    // Recovery must never disrupt the active editing session.
  }
}
