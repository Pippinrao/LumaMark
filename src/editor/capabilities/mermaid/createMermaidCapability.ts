import type { EditorCapability } from '../editorCapability';
import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import { mermaidPreviewExtension } from './mermaidPreviewExtension';

export function createMermaidCapability(
  context: EditorDocumentContext,
): EditorCapability {
  return {
    extensions: [
      mermaidPreviewExtension({
        onMediaPreviewRequest: context.onMediaPreviewRequest,
      }),
    ],
    id: 'mermaid',
  };
}
