export type RecoveryDraft = {
  filePath: string | null;
  text: string;
};

const recoveryDraftKey = 'lumamark-recovery-draft-v1';

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

export function saveRecoveryDraft(draft: RecoveryDraft): void {
  try {
    getStorage()?.setItem(recoveryDraftKey, JSON.stringify(draft));
  } catch {
    // Recovery must never disrupt the active editing session.
  }
}

export function readRecoveryDraft(): RecoveryDraft | null {
  let serialized: string | null | undefined;

  try {
    serialized = getStorage()?.getItem(recoveryDraftKey);
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

    return { filePath: value.filePath, text: value.text };
  } catch {
    return null;
  }
}

export function clearRecoveryDraft(): void {
  try {
    getStorage()?.removeItem(recoveryDraftKey);
  } catch {
    // Recovery must never disrupt the active editing session.
  }
}
