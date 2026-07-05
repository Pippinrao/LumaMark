import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownWysiwygExtension } from '../wysiwyg/markdownDecorations';
import { imagePreviewExtension } from '../widgets/image/ImageWidget';
import { mermaidPreviewExtension } from '../widgets/mermaid/MermaidWidget';
import { tablePreviewExtension } from '../widgets/table/TableWidget';

export type EditorDisplayMode = 'livePreview' | 'source';
export type EditorDocumentContext = {
  path: string | null;
};

export const editorDisplayModeCompartment = new Compartment();

export function editorDisplayModeExtension(
  mode: EditorDisplayMode,
  context: EditorDocumentContext = { path: null },
): Extension {
  if (mode === 'source') {
    return EditorView.editorAttributes.of({
      class: 'lm-editor-source-mode',
    });
  }

  return [
    EditorView.editorAttributes.of({
      class: 'lm-editor-live-preview-mode',
    }),
    markdownWysiwygExtension(),
    imagePreviewExtension({ documentPath: context.path }),
    tablePreviewExtension(),
    mermaidPreviewExtension(),
  ];
}
