import { insertNewlineAndIndent } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../shared/i18n';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { createCodeBlockCapability } from '../code-block/createCodeBlockCapability';
import { activePlantumlBlock } from './plantumlEditingState';
import { plantumlPreviewExtension } from './plantumlPreviewExtension';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

function pressEnter(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    code: 'Enter',
    key: 'Enter',
  });
  return runScopeHandlers(view, event, 'editor') || insertNewlineAndIndent(view);
}

describe('plantuml empty fence auto-close', () => {
  it('enters source editing when an empty plantuml fence is auto-closed', () => {
    const scheduler = new PlantumlRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockRejectedValue(new Error('should not render')),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '```plantuml',
        extensions: [
          markdownLanguage(),
          createCodeBlockCapability().extensions,
          plantumlPreviewExtension({ scheduler }),
        ],
        selection: EditorSelection.cursor('```plantuml'.length),
      }),
    });
    cleanup.push(() => {
      view.destroy();
      parent.remove();
    });

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```plantuml\n\n```');
    expect(activePlantumlBlock(view.state)).toEqual({
      from: 0,
      to: view.state.doc.length,
    });
    expect(parent.querySelector('.lm-plantuml-preview-editing')).not.toBeNull();
    expect(parent.querySelector('.lm-plantuml-preview-error')).toBeNull();
    expect(parent.querySelector('[data-status="empty"]')?.textContent).toBe(
      i18n.t('plantuml.emptyPreview'),
    );
  });
});
