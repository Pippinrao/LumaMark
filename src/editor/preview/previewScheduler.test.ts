import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  PREVIEW_PASS_BUDGET_MS,
  previewPassEffect,
  previewSchedulerExtension,
} from './previewScheduler';

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe('preview scheduler', () => {
  it('keeps the preview pass under one animation-frame budget', () => {
    expect(PREVIEW_PASS_BUDGET_MS).toBeGreaterThanOrEqual(6);
    expect(PREVIEW_PASS_BUDGET_MS).toBeLessThanOrEqual(8);
  });

  it('dispatches one preview pass on the next animation frame after a viewport change', async () => {
    const parent = document.createElement('div');
    parent.style.height = '120px';
    parent.style.overflow = 'hidden';
    document.body.appendChild(parent);
    const passes: number[] = [];
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: `${'Paragraph line that should overflow the viewport.\n'.repeat(80)}Tail`,
        extensions: [
          markdownLanguage(),
          previewSchedulerExtension(),
          EditorView.updateListener.of((update) => {
            if (
              update.transactions.some((transaction) =>
                transaction.effects.some((effect) => effect.is(previewPassEffect)),
              )
            ) {
              passes.push(update.transactions.length);
            }
          }),
        ],
      }),
    });

    expect(passes).toHaveLength(0);
    view.scrollDOM.scrollTop += 280;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'start' }),
    });
    expect(passes).toHaveLength(0);

    await waitForAnimationFrame();
    expect(passes).toHaveLength(1);

    view.destroy();
    parent.remove();
  });
});
