import type { EditorCapability } from '../editorCapability';
import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import { plantumlPreviewExtension } from './plantumlPreviewExtension';

export function createPlantumlCapability(
  context: EditorDocumentContext,
): EditorCapability {
  return {
    extensions: [
      plantumlPreviewExtension({
        onMediaPreviewRequest: context.onMediaPreviewRequest,
      }),
    ],
    id: 'plantuml',
  };
}
