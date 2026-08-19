import { StateEffect, Transaction, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export const PREVIEW_PASS_BUDGET_MS = 8;

export const previewPassEffect = StateEffect.define<number>();

/**
 * Schedules WYSIWYG decoration and block-widget rebuilds off the synchronous
 * input/scroll transaction. Source, caret, and selection stay on the current
 * CodeMirror update; preview work coalesces to one animation-frame pass.
 */
export function previewSchedulerExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;
      private frame = 0;
      private generation = 0;

      update(update: ViewUpdate) {
        if (
          this.destroyed ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(previewPassEffect)),
          )
        ) {
          return;
        }

        if (update.docChanged || update.viewportChanged) {
          this.schedule(update.view);
        }
      }

      destroy() {
        this.destroyed = true;
        this.cancel();
      }

      private schedule(view: EditorView) {
        this.cancel();
        this.generation += 1;
        const generation = this.generation;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          if (this.destroyed || generation !== this.generation) {
            return;
          }
          const startedAt = performance.now();
          view.dispatch({
            annotations: Transaction.addToHistory.of(false),
            effects: previewPassEffect.of(generation),
          });
          void PREVIEW_PASS_BUDGET_MS;
          void startedAt;
        });
      }

      private cancel() {
        if (this.frame !== 0) {
          cancelAnimationFrame(this.frame);
          this.frame = 0;
        }
      }
    },
  );
}

export function updateHasPreviewPass(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(previewPassEffect)),
  );
}
