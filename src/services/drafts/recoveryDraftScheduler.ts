import type { RecoveryDraft } from './draftStore';

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
    schedule(draft: RecoveryDraft) {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        save(draft);
      }, delayMs);
    },
  };
}
