import { diff } from '@codemirror/merge';
import type { ChangeSpec, Text } from '@codemirror/state';

/**
 * Builds exact, non-overlapping CodeMirror changes for the save-only document
 * preparation path. The upstream diff runs without a scan limit or timeout, so
 * it cannot silently fall back to an imprecise mapping.
 */
export function createExactDocumentChanges(
  current: Text,
  prepared: Text,
): readonly ChangeSpec[] {
  return diff(current.toString(), prepared.toString()).map((change) => ({
    from: change.fromA,
    insert: prepared.slice(change.fromB, change.toB),
    to: change.toA,
  }));
}
