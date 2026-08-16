import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import { editorDisplayModeExtension } from '../../core/editorDisplayMode';
import { createLivePreviewCapabilities } from '..';
import { createMathCapability } from './createMathCapability';

const context: EditorDocumentContext = {
  documentId: 'document:test',
  path: null,
};

describe('createMathCapability', () => {
  it('creates an editor-core capability for live preview and reading modes', () => {
    const live = createMathCapability(context, 'livePreview');
    const reading = createMathCapability(context, 'reading');

    expect(live.id).toBe('math');
    expect(reading.id).toBe('math');
    expect(live.extensions.length).toBeGreaterThan(0);
    expect(reading.extensions.length).toBeGreaterThan(0);
  });

  it('registers math in the production capability sequence with document identity', () => {
    expect(
      createLivePreviewCapabilities(context, false).map(({ id }) => id),
    ).toEqual(['codeBlock', 'image', 'table', 'mermaid', 'math']);
    expect(
      createLivePreviewCapabilities(context, true).map(({ id }) => id),
    ).toEqual(['codeBlock', 'image', 'table', 'mermaid', 'math']);
  });

  it('does not install math capability in source mode', () => {
    const sourceExtensions = editorDisplayModeExtension('source', context);
    const state = EditorState.create({
      doc: '$x$',
      extensions: sourceExtensions,
    });

    expect(state.doc.toString()).toBe('$x$');
  });
});
