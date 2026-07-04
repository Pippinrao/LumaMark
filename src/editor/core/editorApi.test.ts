import { describe, expect, it } from 'vitest';
import { createEditorApi } from './editorApi';

describe('editorApi', () => {
  it('loads, reads, focuses, and destroys the editor document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: '# Initial\n',
      parent,
    });

    editor.loadDocument('# Loaded\n\nMarkdown body.\n');

    expect(editor.getDocumentText()).toBe('# Loaded\n\nMarkdown body.\n');

    editor.focus();

    expect(parent.contains(document.activeElement)).toBe(true);

    editor.destroy();
    parent.remove();
  });
});
