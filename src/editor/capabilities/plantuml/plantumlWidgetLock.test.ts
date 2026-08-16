import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorRenderLockExtension } from '../../core/editorRenderLock';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';
import { plantumlPreviewExtension } from './plantumlPreviewExtension';

const plantumlDocument = [
  'before',
  '',
  '```plantuml',
  '@startuml',
  'A -> B',
  '@enduml',
  '```',
  '',
  'after',
].join('\n');

describe('PlantUML reading-mode render lock', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy();
    }
  });

  it('hides Edit and Delete while keeping Expand in a locked editor', async () => {
    const scheduler = new PlantumlRenderScheduler({
      debounceMs: 0,
      render: async () => '<svg data-testid="plantuml-svg"></svg>',
    });
    const onMediaPreviewRequest = vi.fn();
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: plantumlDocument,
        extensions: [
          markdownLanguage(),
          editorRenderLockExtension(true),
          plantumlPreviewExtension({
            onMediaPreviewRequest,
            scheduler,
          }),
        ],
      }),
    });
    views.push(view);

    await vi.waitFor(() => {
      expect(
        view.dom.querySelector('.lm-plantuml-preview')?.getAttribute('data-status'),
      ).toBe('success');
    });

    expect(view.dom.querySelector('.lm-plantuml-edit-source')).toBeNull();
    expect(view.dom.querySelector('.lm-plantuml-delete')).toBeNull();
    expect(view.dom.querySelector('[data-lm-media-preview-button]')).not.toBeNull();
  });

  it('keeps Edit and Delete available when the editor is unlocked', async () => {
    const scheduler = new PlantumlRenderScheduler({
      debounceMs: 0,
      render: async () => '<svg></svg>',
    });
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: plantumlDocument,
        extensions: [
          markdownLanguage(),
          editorRenderLockExtension(false),
          plantumlPreviewExtension({ scheduler }),
        ],
      }),
    });
    views.push(view);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('.lm-plantuml-edit-source')).not.toBeNull();
    });
    expect(view.dom.querySelector('.lm-plantuml-delete')).not.toBeNull();
  });
});
