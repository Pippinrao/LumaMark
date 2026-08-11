import { Facet, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type ReadOnlyEditAttemptHandler = () => void;

export const readOnlyEditAttemptFacet = Facet.define<
  ReadOnlyEditAttemptHandler | null,
  ReadOnlyEditAttemptHandler | null
>({
  combine: (values) => values.find((value) => value != null) ?? null,
});

export function announceReadOnlyEditAttempt(view: EditorView): void {
  view.state.facet(readOnlyEditAttemptFacet)?.();
}

/**
 * Surfaces read-only edit attempts (typing/paste) to the shell so the status
 * bar can flash. Format shortcuts go through markdownFormatCommands instead.
 */
export function readOnlyEditAttemptExtension(
  onAttempt?: ReadOnlyEditAttemptHandler,
): Extension {
  return [
    readOnlyEditAttemptFacet.of(onAttempt ?? null),
    EditorView.domEventHandlers({
      beforeinput(event, view) {
        if (!view.state.readOnly) {
          return false;
        }

        if (
          event.inputType.startsWith('insert') ||
          event.inputType.startsWith('delete') ||
          event.inputType.startsWith('history')
        ) {
          event.preventDefault();
          announceReadOnlyEditAttempt(view);
          return true;
        }

        return false;
      },
      paste(event, view) {
        if (!view.state.readOnly) {
          return false;
        }

        event.preventDefault();
        announceReadOnlyEditAttempt(view);
        return true;
      },
    }),
  ];
}
