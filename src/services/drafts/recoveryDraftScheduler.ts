import type { RecoveryDraft } from './draftStore';

type RecoveryDraftSource = RecoveryDraft | (() => RecoveryDraft | null);

export function createRecoveryDraftScheduler(
  save: (draft: RecoveryDraft) => void,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    schedule(draft: RecoveryDraftSource) {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        const snapshot = typeof draft === 'function' ? draft() : draft;
        if (snapshot) {
          save(snapshot);
        }
      }, delayMs);
    },
  };
}
